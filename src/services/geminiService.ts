import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Book, StoryNode, NodeType, PromptTaskType } from '../types';
import { GenesisResponse, ExpansionResponse, GenesisResponseSchema, ExpansionResponseSchema } from '../schemas';
import { useStore } from '../store';
import { db } from '../db';
import {
  buildOpenAIChatCompletionsUrl,
  formatOpenAINetworkError,
} from './openaiCompat';
import { createDefaultPromptProfile, renderPrompt } from './promptProfiles';
import { buildFactPromptContext } from './factLibrary';
import { buildMaterialPromptContext } from './materialLibrary';

// Type definitions for internal task identification
type TaskType = PromptTaskType;
type CreativityProfile = {
  genesis: number;
  expansion: number;
  drafting: number;
  polishing: number;
};

interface TaskRuntimeConfig {
  provider: 'google' | 'openai';
  apiKey: string;
  baseUrl?: string;
  modelName: string;
  temperature: number;
  enableQualityCheck: boolean;
  enableCreativitySeeds: boolean;
  creativeToolkit: {
    antiBlockMode: boolean;
    divergenceBoost: number;
    twistIntensity: number;
    paceVariance: number;
  };
}

const DEFAULT_CREATIVITY: CreativityProfile = {
  genesis: 0.9,
  expansion: 0.8,
  drafting: 0.75,
  polishing: 0.6,
};

const clampTemperature = (temperature: number) => Math.max(0, Math.min(1, temperature));

const resolveTaskTemperature = (task: TaskType, profile: CreativityProfile): number => {
  switch (task) {
    case 'genesis':
      return clampTemperature(profile.genesis);
    case 'expansion':
      return clampTemperature(profile.expansion);
    case 'drafting':
      return clampTemperature(profile.drafting);
    case 'polishing':
      return clampTemperature(profile.polishing);
    case 'chat':
      return 0.7;
    default:
      return 0.7;
  }
};

const ensureNotAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException('Operation aborted', 'AbortError');
  }
};

const getPromptControls = (task: TaskType, config: TaskRuntimeConfig) => {
  const parts: string[] = [];

  if (config.enableCreativitySeeds && task !== 'polishing') {
    const creativitySeed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    parts.push(`[创意种子]\nSeed: ${creativitySeed}\n在不破坏逻辑前提下，允许加入少量新颖但可解释的创意。`);
  }

  if (config.enableQualityCheck) {
    parts.push(
      `[质量闸门]\n输出前请做一次自检，确保：角色动机一致、时间线无冲突、世界观规则不自相矛盾。若发现冲突，先修正后输出最终结果。`
    );
  }

  if (task !== 'genesis') {
    parts.push(
      `[创意控制参数]\n发散度=${config.creativeToolkit.divergenceBoost.toFixed(2)}; 反转强度=${config.creativeToolkit.twistIntensity.toFixed(2)}; 节奏波动=${config.creativeToolkit.paceVariance.toFixed(2)}。`
    );
  }

  if (config.creativeToolkit.antiBlockMode && (task === 'drafting' || task === 'expansion' || task === 'chat')) {
    parts.push(
      `[防卡文规则]\n请在结果中确保“至少一个推进动作 + 一个冲突升级点 + 一个下一步悬念钩子”，避免剧情原地踏步。`
    );
  }

  return parts.length > 0 ? `${parts.join('\n\n')}\n` : '';
};

const buildStyleBiblePrompt = (book?: Book | null) => {
  if (!book) return '';

  const segments: string[] = [];
  if (book.writingStyle) {
    segments.push(`目标文风: ${book.writingStyle}`);
  }
  if (Array.isArray(book.styleReferences) && book.styleReferences.length > 0) {
    segments.push(`参考作品: ${book.styleReferences.join('、')}`);
  }

  const rules = book.styleBible?.rules?.trim();
  if (rules) {
    segments.push(`风格规则:\n${rules}`);
  }

  if (Array.isArray(book.styleBible?.bannedTerms) && book.styleBible.bannedTerms.length > 0) {
    segments.push(`禁用词: ${book.styleBible.bannedTerms.join('、')}`);
  }

  if (Array.isArray(book.styleBible?.sentencePatterns) && book.styleBible.sentencePatterns.length > 0) {
    segments.push(`句式偏好: ${book.styleBible.sentencePatterns.join('；')}`);
  }

  if (segments.length === 0) return '';
  return `[风格圣经]\n${segments.join('\n')}`;
};

interface TaskPromptOptions {
  promptProfileId?: string;
}

interface TaskContextOverrides {
  hierarchyContext?: string;
  linearContext?: string;
  semanticContext?: string;
  factSummary?: string;
  factHardConstraints?: string;
  factSoftContext?: string;
  materialSummary?: string;
  materialContext?: string;
  styleBiblePrompt?: string;
}

export interface InspirationPack {
  direction: string;
  nextBeats: string[];
  conflictEscalations: string[];
  twists: string[];
  dialogueHooks: string[];
  sensoryAnchors: string[];
  cliffhangers: string[];
}

const getActivePromptProfile = (options?: TaskPromptOptions) => {
  const state = useStore.getState();
  const builtin = createDefaultPromptProfile();
  const profiles = (state.promptProfiles && state.promptProfiles.length > 0)
    ? state.promptProfiles
    : [builtin];
  const targetProfileId = options?.promptProfileId || state.activePromptProfileId;
  return profiles.find((profile) => profile.id === targetProfileId)
    || profiles[0]
    || builtin;
};

const getTaskPrompts = (
  task: TaskType,
  variables: Record<string, string | number | undefined>,
  options?: TaskPromptOptions
) => {
  const profile = getActivePromptProfile(options);
  const fallback = createDefaultPromptProfile().templates[task];
  const template = profile.templates?.[task] || fallback;

  return {
    systemPrompt: renderPrompt(template.systemPrompt || fallback.systemPrompt, variables).trim(),
    userPrompt: renderPrompt(template.userPrompt || fallback.userPrompt, variables).trim(),
  };
};

// Helper to get configuration
const getConfigForTask = (task: TaskType): TaskRuntimeConfig => {
  const state = useStore.getState();
  if (!state.models || state.models.length === 0) {
    throw new Error('请先在 AI 模型中控台添加并配置一个模型。');
  }

  const config = state.modelConfig;
  const creativityProfile = config.creativityLevel || DEFAULT_CREATIVITY;

  let modelId = '';
  switch (task) {
    case 'genesis': modelId = config.genesisModelId; break;
    case 'expansion': modelId = config.expansionModelId; break;
    case 'drafting': modelId = config.draftingModelId; break;
    case 'polishing': modelId = config.polishingModelId; break;
    case 'chat': modelId = config.chatModelId; break;
  }

  const modelDef = state.models.find(m => m.id === modelId) || state.models[0];
  if (!modelDef) {
    throw new Error('未找到可用模型，请先在 AI 模型中控台添加模型。');
  }

  let finalModelName = modelDef.modelName;
  let provider = modelDef.provider;

  // Auto-detect OpenAI compatible if baseUrl is set (robustness fix)
  if (modelDef.baseUrl && modelDef.baseUrl.trim() !== '') {
    provider = 'openai';
  }

  // Fallback order:
  // 1) model-specific key configured in UI
  // 2) provider-specific key from .env.local (Vite env)
  // 3) generic VITE_API_KEY
  const envApiKey = provider === 'google'
    ? (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY)
    : (import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.VITE_API_KEY);

  const apiKey = modelDef.apiKey?.trim() ? modelDef.apiKey.trim() : (envApiKey?.trim() || '');

  if (!apiKey) {
    throw new Error("API Key not configured for this model.");
  }

  if (provider === 'google') {
    if (finalModelName === 'gemini-flash') finalModelName = 'gemini-1.5-flash-latest';
    if (finalModelName === 'gemini-pro') finalModelName = 'gemini-1.5-pro-latest';
  }

  return {
    provider: provider as 'google' | 'openai',
    apiKey,
    baseUrl: modelDef.baseUrl,
    modelName: finalModelName,
    temperature: resolveTaskTemperature(task, creativityProfile),
    enableQualityCheck: Boolean(config.enableQualityCheck),
    enableCreativitySeeds: Boolean(config.enableCreativitySeeds),
    creativeToolkit: {
      antiBlockMode: Boolean(config.creativeToolkit?.antiBlockMode ?? true),
      divergenceBoost: Math.max(0, Math.min(1, Number(config.creativeToolkit?.divergenceBoost ?? 0.65))),
      twistIntensity: Math.max(0, Math.min(1, Number(config.creativeToolkit?.twistIntensity ?? 0.55))),
      paceVariance: Math.max(0, Math.min(1, Number(config.creativeToolkit?.paceVariance ?? 0.5))),
    },
  };
};

const updateStatus = (status: string) => {
  useStore.getState().setGenerationStatus(status);
};

const shouldUseBackendAI = () => typeof window !== 'undefined' && !Boolean(import.meta.env.VITEST);

const runBackendTask = async (
  taskType: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
) => {
  const response = await fetch('/api/v1/ai/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskType,
      input,
      wait: true,
    }),
    signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || `Backend task failed: ${response.status}`);
  }

  const payload = await response.json() as { result?: unknown };
  return payload.result ?? payload;
};

const EMPTY_FACT_CONTEXT = buildFactPromptContext([]);
const EMPTY_MATERIAL_CONTEXT = buildMaterialPromptContext([], '');

const getFactContextForBook = async (bookId?: string) => {
  if (!bookId) return EMPTY_FACT_CONTEXT;
  try {
    const facts = await db.facts.where('bookId').equals(bookId).toArray();
    return buildFactPromptContext(facts);
  } catch (error) {
    console.error('Failed to load fact context:', error);
    return EMPTY_FACT_CONTEXT;
  }
};

const getMaterialContextForBook = async (bookId: string | undefined, query: string) => {
  if (!bookId) return EMPTY_MATERIAL_CONTEXT;
  try {
    const materials = await db.materials.where('bookId').equals(bookId).toArray();
    return buildMaterialPromptContext(materials, query, 5);
  } catch (error) {
    console.error('Failed to load material context:', error);
    return EMPTY_MATERIAL_CONTEXT;
  }
};

const estimatePricePer1kTokens = (provider: 'google' | 'openai', modelName: string) => {
  const normalizedModel = modelName.toLowerCase();
  if (provider === 'google') {
    if (normalizedModel.includes('pro')) return 0.005;
    return 0.001;
  }
  if (normalizedModel.includes('gpt-4') || normalizedModel.includes('o1') || normalizedModel.includes('o3')) {
    return 0.01;
  }
  return 0.002;
};

const recordUsage = (
  taskType: TaskType,
  config: TaskRuntimeConfig,
  inputText: string,
  outputText: string
) => {
  const estimatedTokens = Math.ceil((inputText.length + outputText.length) / 4);
  const estimatedCostUSD = Number(((estimatedTokens / 1000) * estimatePricePer1kTokens(config.provider, config.modelName)).toFixed(6));

  useStore.getState().addUsageEntry({
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    taskType,
    provider: config.provider,
    modelName: config.modelName,
    inputChars: inputText.length,
    outputChars: outputText.length,
    estimatedTokens,
    estimatedCostUSD,
  });
};

const getNodeTypeName = (type: string) => {
  switch (type) {
    case 'volume': return '卷';
    case 'arc': return '大剧情';
    case 'chapter': return '章';
    case 'scene': return '场景';
    default: return type;
  }
};

// --- OpenAI Compatible Helpers ---

async function callOpenAI(
  config: { apiKey: string, baseUrl?: string, modelName: string, temperature: number },
  messages: { role: string, content: string }[],
  jsonMode: boolean = false,
  signal?: AbortSignal
): Promise<string> {
  ensureNotAborted(signal);
  const url = buildOpenAIChatCompletionsUrl(config.baseUrl);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };

  const body: any = {
    model: config.modelName,
    messages: messages,
    temperature: config.temperature,
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error: any) {
    console.error("OpenAI Call Failed", error);
    throw formatOpenAINetworkError(error, url);
  }
}

async function* callOpenAIStream(
  config: { apiKey: string, baseUrl?: string, modelName: string, temperature: number },
  messages: { role: string, content: string }[],
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  ensureNotAborted(signal);
  const url = buildOpenAIChatCompletionsUrl(config.baseUrl);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.modelName,
        messages: messages,
        stream: true,
        temperature: config.temperature
      }),
      signal
    });
  } catch (error) {
    throw formatOpenAINetworkError(error, url);
  }

  if (!response.ok) {
    const err = await response.text();
    const streamUnsupported = response.status === 400
      || response.status === 404
      || response.status === 405
      || response.status === 415
      || response.status === 422
      || /stream|sse|unsupported|not support|not implemented/i.test(err);

    if (streamUnsupported) {
      const fallback = await callOpenAI(config, messages, false, signal);
      if (fallback) yield fallback;
      return;
    }

    throw new Error(`OpenAI Stream Error ${response.status}: ${err}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const fallback = await callOpenAI(config, messages, false, signal);
    if (fallback) yield fallback;
    return;
  }
  const decoder = new TextDecoder("utf-8");

  let buffer = '';
  while (true) {
    ensureNotAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep partial line

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === '[DONE]') return;
        try {
          const json = JSON.parse(jsonStr);
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch (e) {
          // ignore parse errors for partial chunks
        }
      }
    }
  }
}

// --- Main Functions ---

/**
 * GENESIS: From a single sentence to a Book structure.
 */
export const genesis = async (userPrompt: string, signal?: AbortSignal): Promise<GenesisResponse> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      updateStatus('正在请求后端创世引擎...');
      const result = await runBackendTask('genesis', { userPrompt }, signal) as { kind?: string } & GenesisResponse;
      if (result && result.kind === 'genesis') {
        return {
          title: result.title,
          premise: result.premise,
          worldSetting: result.worldSetting,
          characters: result.characters,
          initialVolumes: result.initialVolumes,
        };
      }
    } catch (error) {
      console.warn('Backend genesis unavailable, fallback to direct provider.', error);
    }
  }
  updateStatus("正在连接创世引擎...");
  const config = getConfigForTask('genesis');
  const controls = getPromptControls('genesis', config);
  const prompts = getTaskPrompts('genesis', {
    controls,
    userPrompt,
  });
  const userContent = prompts.userPrompt;
  const systemPrompt = prompts.systemPrompt;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });

    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        premise: { type: Type.STRING },
        worldSetting: { type: Type.STRING },
        characters: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              role: { type: Type.STRING },
              description: { type: Type.STRING },
              secret: { type: Type.STRING },
            },
            required: ['name', 'role', 'description', 'secret']
          }
        },
        initialVolumes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ['title', 'summary']
          }
        }
      },
      required: ['title', 'premise', 'worldSetting', 'characters', 'initialVolumes']
    };

    updateStatus(`正在使用 ${config.modelName} (Google) 构思世界观...`);
    const response = await ai.models.generateContent({
      model: config.modelName,
      contents: userContent,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: systemPrompt,
        temperature: config.temperature
      }
    } as any);
    const text = response.text;
    if (!text) throw new Error("AI 未返回数据");
    recordUsage('genesis', config, `${systemPrompt}\n${userContent}`, text);
    return GenesisResponseSchema.parse(JSON.parse(text));
  } else {
    // OpenAI Logic
    updateStatus(`正在使用 ${config.modelName} (OpenAI) 构思世界观...`);
    const messages = [
      { role: 'system', content: systemPrompt + "\n请务必返回合法的 JSON 格式，不包含 Markdown 代码块标记。格式如下：\n{ \"title\": \"\", \"premise\": \"\", \"worldSetting\": \"\", \"characters\": [{\"name\":\"\",\"role\":\"\",\"description\":\"\",\"secret\":\"\"}], \"initialVolumes\": [{\"title\":\"\",\"summary\":\"\"}] }" },
      { role: 'user', content: userContent }
    ];

    // Some models (DeepSeek) might not support json_object mode perfectly or requires specific prompting, 
    // but we'll try to use it if we can, or just rely on prompt.
    // Safe bet: standard prompt + cleanup.
    const text = await callOpenAI(config, messages, false, signal);
    recordUsage('genesis', config, messages.map((msg) => msg.content).join('\n\n'), text);

    const cleanText = text.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    try {
      return GenesisResponseSchema.parse(JSON.parse(cleanText));
    } catch (e) {
      console.error("JSON Parse Error", cleanText);
      throw new Error("AI 返回格式错误，请重试");
    }
  }
};

/**
 * EXPANSION: Fractal Recursive Generation
 */
export const expandNode = async (
  parentNode: StoryNode,
  book: Book,
  childType: NodeType,
  signal?: AbortSignal,
  options?: { promptProfileId?: string; contextOverrides?: TaskContextOverrides }
): Promise<ExpansionResponse> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      updateStatus(`正在请求后端扩写服务：${parentNode.title}`);
      const result = await runBackendTask('expansion', {
        bookId: book.id,
        nodeId: parentNode.id,
        childType,
        promptProfileId: options?.promptProfileId,
        contextOverrides: options?.contextOverrides,
      }, signal) as { kind?: string; nodes?: Array<{ title: string; summary: string }> };
      if (result?.kind === 'expansion' && Array.isArray(result.nodes)) {
        return { nodes: result.nodes };
      }
    } catch (error) {
      console.warn('Backend expansion unavailable, fallback to direct provider.', error);
    }
  }
  updateStatus(`正在分析节点: ${parentNode.title}...`);
  const config = getConfigForTask('expansion');
  const controls = getPromptControls('expansion', config);
  const factContext = await getFactContextForBook(book.id);
  const materialContext = await getMaterialContextForBook(book.id, `${parentNode.title}\n${parentNode.summary}`);
  const effectiveFactContext = {
    factSummary: options?.contextOverrides?.factSummary ?? factContext.factSummary,
    factHardConstraints: options?.contextOverrides?.factHardConstraints ?? factContext.factHardConstraints,
    factSoftContext: options?.contextOverrides?.factSoftContext ?? factContext.factSoftContext,
  };
  const effectiveMaterialContext = {
    materialSummary: options?.contextOverrides?.materialSummary ?? materialContext.materialSummary,
    materialContext: options?.contextOverrides?.materialContext ?? materialContext.materialContext,
  };
  const prompts = getTaskPrompts('expansion', {
    controls,
    bookTitle: book.title,
    bookPremise: book.premise,
    charactersSummary: book.characters.map(c => `${c.name}: ${c.role}`).join(', '),
    parentTypeName: getNodeTypeName(parentNode.type),
    parentTitle: parentNode.title,
    parentSummary: parentNode.summary,
    childTypeName: getNodeTypeName(childType),
    factSummary: effectiveFactContext.factSummary,
    factHardConstraints: effectiveFactContext.factHardConstraints,
    factSoftContext: effectiveFactContext.factSoftContext,
    materialSummary: effectiveMaterialContext.materialSummary,
    materialContext: effectiveMaterialContext.materialContext,
  }, options);
  const prompt = prompts.userPrompt;
  const styleBiblePrompt = options?.contextOverrides?.styleBiblePrompt ?? buildStyleBiblePrompt(book);
  const expansionSystemPrompt = `${prompts.systemPrompt}\n\n[事实库硬约束]\n${effectiveFactContext.factHardConstraints}${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${effectiveMaterialContext.materialContext}`;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        nodes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
            },
            required: ['title', 'summary']
          }
        }
      },
      required: ['nodes']
    };

    updateStatus(`正在使用 ${config.modelName} (Google) 构建下层结构...`);
    const response = await ai.models.generateContent({
      model: config.modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        systemInstruction: expansionSystemPrompt,
        temperature: config.temperature,
      },
    } as any);

    const text = response.text;
    if (!text) throw new Error("AI 未返回数据");
    recordUsage('expansion', config, prompt, text);
    return ExpansionResponseSchema.parse(JSON.parse(text));
  } else {
    // OpenAI Logic
    updateStatus(`正在使用 ${config.modelName} (OpenAI) 构建下层结构...`);
    const messages = [
      {
        role: 'system',
        content: `${expansionSystemPrompt}\n请返回 JSON 格式：{ \"nodes\": [{ \"title\": \"...\", \"summary\": \"...\" }] }`
      },
      { role: 'user', content: prompt }
    ];

    const text = await callOpenAI(config, messages, false, signal);
    recordUsage('expansion', config, messages.map((msg) => msg.content).join('\n\n'), text);
    const cleanText = text.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    try {
      return ExpansionResponseSchema.parse(JSON.parse(cleanText));
    } catch (e) {
      console.error("JSON Parse Error", cleanText);
      throw new Error("AI 返回格式错误，请重试");
    }
  }
};

/**
 * DRAFTING: Scene writing with FULL context awareness
 */
export const draftScene = async (
  node: StoryNode,
  book: Book,
  ancestors: StoryNode[],
  linearContext: string,
  semanticContext: string,
  onStream: (chunk: string) => void,
  signal?: AbortSignal,
  options?: { promptProfileId?: string; draftLengthHint?: string; creativeModeHint?: string; antiBlockHint?: string; contextOverrides?: TaskContextOverrides }
): Promise<string> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      updateStatus('正在请求后端起草服务...');
      const result = await runBackendTask('drafting', {
        bookId: book.id,
        nodeId: node.id,
        promptProfileId: options?.promptProfileId,
        draftLengthHint: options?.draftLengthHint,
        creativeModeHint: options?.creativeModeHint,
        antiBlockHint: options?.antiBlockHint,
        contextOverrides: options?.contextOverrides,
      }, signal) as { kind?: string; content?: string };
      if (result?.kind === 'text') {
        const content = String(result.content || '');
        if (content) onStream(content);
        updateStatus('写作完成');
        return content;
      }
    } catch (error) {
      console.warn('Backend drafting unavailable, fallback to direct provider.', error);
    }
  }
  updateStatus("正在读取全书大纲与前文记忆...");
  const config = getConfigForTask('drafting');
  const controls = getPromptControls('drafting', config);
  const factContext = await getFactContextForBook(book.id);
  const materialContext = await getMaterialContextForBook(book.id, `${node.title}\n${node.summary}\n${linearContext.slice(-500)}`);
  const defaultHierarchyContext = ancestors.length > 0
    ? ancestors.map(a => `[${getNodeTypeName(a.type)}: ${a.title}]\n梗概: ${a.summary}`).join('\n\n')
    : "无上级结构信息";
  const effectiveHierarchyContext = options?.contextOverrides?.hierarchyContext ?? defaultHierarchyContext;
  const effectiveLinearContext = options?.contextOverrides?.linearContext ?? (linearContext ? linearContext : "（这是故事的开篇）");
  const effectiveSemanticContext = options?.contextOverrides?.semanticContext ?? (semanticContext ? semanticContext : "（未命中高相关历史片段）");
  const effectiveFactContext = {
    factSummary: options?.contextOverrides?.factSummary ?? factContext.factSummary,
    factHardConstraints: options?.contextOverrides?.factHardConstraints ?? factContext.factHardConstraints,
    factSoftContext: options?.contextOverrides?.factSoftContext ?? factContext.factSoftContext,
  };
  const effectiveMaterialContext = {
    materialSummary: options?.contextOverrides?.materialSummary ?? materialContext.materialSummary,
    materialContext: options?.contextOverrides?.materialContext ?? materialContext.materialContext,
  };
  const prompts = getTaskPrompts('drafting', {
    controls,
    bookTitle: book.title,
    bookPremise: book.premise,
    worldSetting: book.worldSetting,
    charactersJson: JSON.stringify(book.characters.map(c => ({ name: c.name, role: c.role, description: c.description }))),
    hierarchyContext: effectiveHierarchyContext,
    linearContext: effectiveLinearContext,
    semanticContext: effectiveSemanticContext,
    nodeTitle: node.title,
    nodeSummary: node.summary,
    draftLengthHint: options?.draftLengthHint || '中篇幅（约 1000-2000 字）',
    creativeModeHint: options?.creativeModeHint || '平衡推进（剧情与文风并重）',
    antiBlockHint: options?.antiBlockHint || '若出现卡文风险，请优先推进行动线并抛出新问题',
    factSummary: effectiveFactContext.factSummary,
    factHardConstraints: effectiveFactContext.factHardConstraints,
    factSoftContext: effectiveFactContext.factSoftContext,
    materialSummary: effectiveMaterialContext.materialSummary,
    materialContext: effectiveMaterialContext.materialContext,
  }, options);
  const prompt = prompts.userPrompt;
  const styleBiblePrompt = options?.contextOverrides?.styleBiblePrompt ?? buildStyleBiblePrompt(book);
  const draftingSystemPrompt = `${prompts.systemPrompt}\n\n[事实库硬约束]\n${effectiveFactContext.factHardConstraints}${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${effectiveMaterialContext.materialContext}`;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    updateStatus(`正在使用 ${config.modelName} (Google) 编织文字...`);

    const responseStream = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
        systemInstruction: draftingSystemPrompt,
        temperature: config.temperature
      },
      ...(signal ? { signal } : {}),
    } as any);

    let fullText = "";
    for await (const chunk of responseStream) {
      ensureNotAborted(signal);
      const text = chunk.text;
      if (text) {
        fullText += text;
        onStream(text);
      }
    }
    recordUsage('drafting', config, prompt, fullText);
    updateStatus("写作完成");
    return fullText;
  } else {
    // OpenAI Logic
    updateStatus(`正在使用 ${config.modelName} (OpenAI) 编织文字...`);
    const messages = [
      { role: 'system', content: draftingSystemPrompt },
      { role: 'user', content: prompt }
    ];

    let fullText = "";
    for await (const chunk of callOpenAIStream(config, messages, signal)) {
      fullText += chunk;
      onStream(chunk);
    }
    recordUsage('drafting', config, messages.map((msg) => msg.content).join('\n\n'), fullText);
    updateStatus("写作完成");
    return fullText;
  }
};

/**
 * POLISHING: Rewrite selected text
 */
export const polishText = async (
  selection: string,
  context: string,
  book: Book,
  onStream: (chunk: string) => void,
  signal?: AbortSignal,
  options?: { nodeId?: string; promptProfileId?: string; polishRange?: 'selection' | 'scene'; contextOverrides?: TaskContextOverrides }
): Promise<string> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      updateStatus('正在请求后端润色服务...');
      const result = await runBackendTask('polishing', {
        bookId: book.id,
        nodeId: options?.nodeId || useStore.getState().activeNodeId,
        selection,
        context,
        promptProfileId: options?.promptProfileId,
        polishRange: options?.polishRange,
        contextOverrides: options?.contextOverrides,
      }, signal) as { kind?: string; content?: string };
      if (result?.kind === 'text') {
        const content = String(result.content || '');
        if (content) onStream(content);
        updateStatus('润色完成');
        return content;
      }
    } catch (error) {
      console.warn('Backend polishing unavailable, fallback to direct provider.', error);
    }
  }
  updateStatus("正在构思润色方案...");
  const config = getConfigForTask('polishing');
  const controls = getPromptControls('polishing', config);
  const factContext = await getFactContextForBook(book.id);
  const materialContext = await getMaterialContextForBook(book.id, `${selection}\n${context.slice(-500)}`);
  const effectiveFactContext = {
    factSummary: options?.contextOverrides?.factSummary ?? factContext.factSummary,
    factHardConstraints: options?.contextOverrides?.factHardConstraints ?? factContext.factHardConstraints,
    factSoftContext: options?.contextOverrides?.factSoftContext ?? factContext.factSoftContext,
  };
  const effectiveMaterialContext = {
    materialSummary: options?.contextOverrides?.materialSummary ?? materialContext.materialSummary,
    materialContext: options?.contextOverrides?.materialContext ?? materialContext.materialContext,
  };
  const prompts = getTaskPrompts('polishing', {
    controls,
    bookTitle: book.title,
    worldSettingSnippet: `${book.worldSetting.slice(0, 200)}...`,
    contextSnippet: context.slice(-500),
    selection,
    polishRangeHint: options?.polishRange === 'selection' ? '仅润色选中的文本片段' : '润色整段场景文本',
    factSummary: effectiveFactContext.factSummary,
    factHardConstraints: effectiveFactContext.factHardConstraints,
    factSoftContext: effectiveFactContext.factSoftContext,
    materialSummary: effectiveMaterialContext.materialSummary,
    materialContext: effectiveMaterialContext.materialContext,
  }, options);
  const prompt = prompts.userPrompt;
  const styleBiblePrompt = options?.contextOverrides?.styleBiblePrompt ?? buildStyleBiblePrompt(book);
  const polishingSystemPrompt = `${prompts.systemPrompt}\n\n[事实库硬约束]\n${effectiveFactContext.factHardConstraints}${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${effectiveMaterialContext.materialContext}`;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    updateStatus(`使用 ${config.modelName} (Google) 逐字推敲...`);

    const responseStream = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
        systemInstruction: polishingSystemPrompt,
        temperature: config.temperature
      },
      ...(signal ? { signal } : {}),
    } as any);

    let fullText = "";
    for await (const chunk of responseStream) {
      ensureNotAborted(signal);
      const text = chunk.text;
      if (text) {
        fullText += text;
        onStream(text);
      }
    }
    recordUsage('polishing', config, prompt, fullText);
    updateStatus("润色完成");
    return fullText;
  } else {
    // OpenAI Logic
    updateStatus(`使用 ${config.modelName} (OpenAI) 逐字推敲...`);
    const messages = [
      { role: 'system', content: polishingSystemPrompt },
      { role: 'user', content: prompt }
    ];

    let fullText = "";
    for await (const chunk of callOpenAIStream(config, messages, signal)) {
      fullText += chunk;
      onStream(chunk);
    }
    recordUsage('polishing', config, messages.map((msg) => msg.content).join('\n\n'), fullText);
    updateStatus("润色完成");
    return fullText;
  }
};

export const generateRewriteVariants = async (
  selection: string,
  preContext: string,
  postContext: string,
  book: Book,
  signal?: AbortSignal,
  options?: { promptProfileId?: string; variantCount?: number }
): Promise<string[]> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      const result = await runBackendTask('rewrite', {
        bookId: book.id,
        selection,
        preContext,
        postContext,
        variantCount: options?.variantCount,
        promptProfileId: options?.promptProfileId,
      }, signal) as { kind?: string; variants?: string[] };
      if (result?.kind === 'rewrite' && Array.isArray(result.variants)) {
        return result.variants;
      }
    } catch (error) {
      console.warn('Backend rewrite unavailable, fallback to direct provider.', error);
    }
  }
  const config = getConfigForTask('polishing');
  const controls = getPromptControls('polishing', config);
  const factContext = await getFactContextForBook(book.id);
  const materialContext = await getMaterialContextForBook(book.id, `${selection}\n${preContext.slice(-280)}\n${postContext.slice(0, 280)}`);
  const styleBiblePrompt = buildStyleBiblePrompt(book);
  const variantCount = Math.min(5, Math.max(2, options?.variantCount || 3));

  const prompts = getTaskPrompts('polishing', {
    controls,
    bookTitle: book.title,
    worldSettingSnippet: `${book.worldSetting.slice(0, 200)}...`,
    contextSnippet: `${preContext.slice(-320)}\n<<待改写文本>>\n${postContext.slice(0, 320)}`,
    selection,
    polishRangeHint: '仅改写选中的文本片段，不改写上下文',
    factSummary: factContext.factSummary,
    factHardConstraints: factContext.factHardConstraints,
    factSoftContext: factContext.factSoftContext,
    materialSummary: materialContext.materialSummary,
    materialContext: materialContext.materialContext,
  }, options);

  const systemPrompt = `${prompts.systemPrompt}

[事实库硬约束]
${factContext.factHardConstraints}${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}

[素材库参考]
${materialContext.materialContext}

[输出要求]
你必须返回 JSON 格式：{ "variants": ["改写版本1", "改写版本2", "改写版本3"] }。
禁止输出 Markdown 代码块。每个版本应语义一致，但风格、节奏、句式有差异。`;

  const userPrompt = `${prompts.userPrompt}

[额外任务]
请给出 ${variantCount} 个可直接替换的改写版本，仅改写“选中文本”，不要复述上下文。`;

  const parseVariants = (raw: string) => {
    const clean = raw.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean) as { variants?: string[] };
    const variants = Array.isArray(parsed.variants)
      ? parsed.variants.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    return variants.slice(0, variantCount);
  };

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const response = await ai.models.generateContent({
      model: config.modelName,
      contents: userPrompt,
      config: {
        responseMimeType: 'application/json',
        systemInstruction: systemPrompt,
        temperature: Math.max(config.temperature, 0.65),
      },
    } as any);

    const text = response.text || '';
    recordUsage('polishing', config, `${systemPrompt}\n\n${userPrompt}`, text);
    const variants = parseVariants(text);
    if (variants.length === 0) {
      throw new Error('改写结果为空，请重试。');
    }
    return variants;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const text = await callOpenAI(config, messages, false, signal);
  recordUsage('polishing', config, messages.map((msg) => msg.content).join('\n\n'), text);
  const variants = parseVariants(text);
  if (variants.length === 0) {
    throw new Error('改写结果为空，请重试。');
  }
  return variants;
};

/**
 * CHAT: Conversational Assistant
 */
export const chat = async (
  history: { role: 'user' | 'assistant' | 'system', content: string }[],
  context: string,
  onStream: (chunk: string) => void,
  signal?: AbortSignal,
  options?: { promptProfileId?: string }
): Promise<string> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      const currentBook = useStore.getState().currentBook;
      const result = await runBackendTask('chat', {
        bookId: currentBook?.id,
        history,
        context,
        promptProfileId: options?.promptProfileId,
      }, signal) as { kind?: string; content?: string };
      if (result?.kind === 'text') {
        const content = String(result.content || '');
        if (content) onStream(content);
        return content;
      }
    } catch (error) {
      console.warn('Backend chat unavailable, fallback to direct provider.', error);
    }
  }
  // Use chat model for chat as it usually requires decent reasoning
  const config = getConfigForTask('chat');
  const controls = getPromptControls('chat', config);
  const currentBook = useStore.getState().currentBook;
  const factContext = await getFactContextForBook(currentBook?.id);
  const dialogue = history
    .map((msg) => {
      if (msg.role === 'assistant') return `助手: ${msg.content}`;
      if (msg.role === 'system') return `系统: ${msg.content}`;
      return `用户: ${msg.content}`;
    })
    .join('\n\n');
  const materialContext = await getMaterialContextForBook(currentBook?.id, `${context}\n${dialogue.slice(-600)}`);
  const prompts = getTaskPrompts('chat', {
    controls,
    chatContext: context,
    dialogue,
    factSummary: factContext.factSummary,
    factHardConstraints: factContext.factHardConstraints,
    factSoftContext: factContext.factSoftContext,
    materialSummary: materialContext.materialSummary,
    materialContext: materialContext.materialContext,
  }, options);
  const styleBiblePrompt = buildStyleBiblePrompt(currentBook);

  const systemMessage = {
    role: 'system' as const,
    content: `${prompts.systemPrompt}\n\n[事实库硬约束]\n${factContext.factHardConstraints}${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${materialContext.materialContext}`,
  };

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const prompt = `${systemMessage.content}\n\n${prompts.userPrompt}`;

    const result = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
        temperature: config.temperature,
        maxOutputTokens: 2000,
      },
      ...(signal ? { signal } : {}),
    } as any);

    let fullText = "";
    for await (const chunk of result) {
      ensureNotAborted(signal);
      const text = chunk.text;
      if (text) {
        fullText += text;
        onStream(text);
      }
    }
    recordUsage('chat', config, prompt, fullText);
    return fullText;

  } else {
    // OpenAI Logic
    const messages = [
      systemMessage,
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: prompts.userPrompt },
    ];

    let fullText = "";
    for await (const chunk of callOpenAIStream(config, messages, signal)) {
      fullText += chunk;
      onStream(chunk);
    }
    recordUsage('chat', config, messages.map((msg) => msg.content).join('\n\n'), fullText);
    return fullText;
  }
};

export const generateInspirationPack = async (
  node: StoryNode,
  book: Book,
  ancestors: StoryNode[],
  linearContext: string,
  semanticContext: string,
  signal?: AbortSignal
): Promise<InspirationPack> => {
  ensureNotAborted(signal);
  if (shouldUseBackendAI()) {
    try {
      const result = await runBackendTask('creative_rescue', {
        bookId: book.id,
        nodeId: node.id,
      }, signal) as { kind?: string } & InspirationPack;
      if (result?.kind === 'creative_rescue') {
        return {
          direction: result.direction,
          nextBeats: result.nextBeats,
          conflictEscalations: result.conflictEscalations,
          twists: result.twists,
          dialogueHooks: result.dialogueHooks,
          sensoryAnchors: result.sensoryAnchors,
          cliffhangers: result.cliffhangers,
        };
      }
    } catch (error) {
      console.warn('Backend creative rescue unavailable, fallback to direct provider.', error);
    }
  }
  updateStatus('正在生成卡文急救灵感包...');
  const config = getConfigForTask('chat');
  const controls = getPromptControls('chat', config);
  const factContext = await getFactContextForBook(book.id);
  const materialContext = await getMaterialContextForBook(book.id, `${node.title}\n${node.summary}\n${(node.content || '').slice(-800)}`);
  const styleBiblePrompt = buildStyleBiblePrompt(book);

  const hierarchyContext = ancestors.length > 0
    ? ancestors.map((ancestor) => `[${getNodeTypeName(ancestor.type)}] ${ancestor.title} - ${ancestor.summary}`).join('\n')
    : '无上级结构信息';

  const prompt = `${controls}
[书籍]
书名: ${book.title}
梗概: ${book.premise}

[当前场景]
标题: ${node.title}
细纲: ${node.summary}
正文片段: ${(node.content || '').slice(-1200) || '（暂无正文）'}

[层级上下文]
${hierarchyContext}

[近期线性记忆]
${linearContext || '（开篇，无前文）'}

[语义检索记忆]
${semanticContext || '（无高相关片段）'}

[风格圣经]
${styleBiblePrompt || '（未配置）'}

[事实库]
${factContext.factHardConstraints}
${factContext.factSoftContext}

[素材库]
${materialContext.materialContext}

[任务]
你要输出一个“卡文急救灵感包”，帮助作者立刻继续写。必须是简体中文，且仅返回 JSON：
{
  "direction": "一句话推进方向",
  "nextBeats": ["...","...","..."],
  "conflictEscalations": ["...","...","..."],
  "twists": ["...","...","..."],
  "dialogueHooks": ["...","...","..."],
  "sensoryAnchors": ["...","...","..."],
  "cliffhangers": ["...","...","..."]
}
规则：
1) 每个数组给 3-5 条短句，必须可直接写进正文。
2) 不要复述空话，不要解释 JSON。
3) 严格遵守锁定事实，不得冲突。`;

  const parsePack = (raw: string): InspirationPack => {
    const clean = raw.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean) as Partial<InspirationPack>;

    const ensureList = (list: unknown) => (
      Array.isArray(list)
        ? list.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
        : []
    );

    return {
      direction: String(parsed.direction || '').trim(),
      nextBeats: ensureList(parsed.nextBeats),
      conflictEscalations: ensureList(parsed.conflictEscalations),
      twists: ensureList(parsed.twists),
      dialogueHooks: ensureList(parsed.dialogueHooks),
      sensoryAnchors: ensureList(parsed.sensoryAnchors),
      cliffhangers: ensureList(parsed.cliffhangers),
    };
  };

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const schema: Schema = {
      type: Type.OBJECT,
      properties: {
        direction: { type: Type.STRING },
        nextBeats: { type: Type.ARRAY, items: { type: Type.STRING } },
        conflictEscalations: { type: Type.ARRAY, items: { type: Type.STRING } },
        twists: { type: Type.ARRAY, items: { type: Type.STRING } },
        dialogueHooks: { type: Type.ARRAY, items: { type: Type.STRING } },
        sensoryAnchors: { type: Type.ARRAY, items: { type: Type.STRING } },
        cliffhangers: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['direction', 'nextBeats', 'conflictEscalations', 'twists', 'dialogueHooks', 'sensoryAnchors', 'cliffhangers'],
    };

    const response = await ai.models.generateContent({
      model: config.modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        systemInstruction: `你是资深小说策划编辑，擅长在不破坏设定的前提下快速解卡。请仅输出 JSON。${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${materialContext.materialContext}`,
        temperature: Math.max(0.7, config.temperature),
      },
    } as any);

    const text = response.text || '';
    recordUsage('chat', config, prompt, text);
    return parsePack(text);
  }

  const messages = [
    {
      role: 'system',
      content: `你是资深小说策划编辑，擅长在不破坏设定的前提下快速解卡。请仅输出 JSON。${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${materialContext.materialContext}`,
    },
    {
      role: 'user',
      content: prompt,
    },
  ];
  const text = await callOpenAI(config, messages, false, signal);
  recordUsage('chat', config, messages.map((item) => item.content).join('\n\n'), text);
  return parsePack(text);
};
