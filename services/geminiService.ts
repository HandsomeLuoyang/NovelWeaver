import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Book, StoryNode, NodeType, PromptTaskType } from '../types';
import { GenesisResponse, ExpansionResponse, GenesisResponseSchema, ExpansionResponseSchema } from '../schemas';
import { useStore } from '../store';
import {
  buildOpenAIChatCompletionsUrl,
  formatOpenAINetworkError,
} from './openaiCompat';
import { createDefaultPromptProfile, renderPrompt } from './promptProfiles';

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

  return parts.length > 0 ? `${parts.join('\n\n')}\n` : '';
};

const getActivePromptProfile = () => {
  const state = useStore.getState();
  const builtin = createDefaultPromptProfile();
  const profiles = (state.promptProfiles && state.promptProfiles.length > 0)
    ? state.promptProfiles
    : [builtin];
  return profiles.find((profile) => profile.id === state.activePromptProfileId)
    || profiles[0]
    || builtin;
};

const getTaskPrompts = (
  task: TaskType,
  variables: Record<string, string | number | undefined>
) => {
  const profile = getActivePromptProfile();
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
  };
};

const updateStatus = (status: string) => {
  useStore.getState().setGenerationStatus(status);
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
  signal?: AbortSignal
): Promise<ExpansionResponse> => {
  ensureNotAborted(signal);
  updateStatus(`正在分析节点: ${parentNode.title}...`);
  const config = getConfigForTask('expansion');
  const controls = getPromptControls('expansion', config);
  const prompts = getTaskPrompts('expansion', {
    controls,
    bookTitle: book.title,
    bookPremise: book.premise,
    charactersSummary: book.characters.map(c => `${c.name}: ${c.role}`).join(', '),
    parentTypeName: getNodeTypeName(parentNode.type),
    parentTitle: parentNode.title,
    parentSummary: parentNode.summary,
    childTypeName: getNodeTypeName(childType),
  });
  const prompt = prompts.userPrompt;

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
        systemInstruction: prompts.systemPrompt,
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
        content: `${prompts.systemPrompt}\n请返回 JSON 格式：{ \"nodes\": [{ \"title\": \"...\", \"summary\": \"...\" }] }`
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
  signal?: AbortSignal
): Promise<string> => {
  ensureNotAborted(signal);
  updateStatus("正在读取全书大纲与前文记忆...");
  const config = getConfigForTask('drafting');
  const controls = getPromptControls('drafting', config);

  const hierarchyContext = ancestors.length > 0
    ? ancestors.map(a => `[${getNodeTypeName(a.type)}: ${a.title}]\n梗概: ${a.summary}`).join('\n\n')
    : "无上级结构信息";
  const prompts = getTaskPrompts('drafting', {
    controls,
    bookTitle: book.title,
    bookPremise: book.premise,
    worldSetting: book.worldSetting,
    charactersJson: JSON.stringify(book.characters.map(c => ({ name: c.name, role: c.role, description: c.description }))),
    hierarchyContext,
    linearContext: linearContext ? linearContext : "（这是故事的开篇）",
    semanticContext: semanticContext ? semanticContext : "（未命中高相关历史片段）",
    nodeTitle: node.title,
    nodeSummary: node.summary,
  });
  const prompt = prompts.userPrompt;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    updateStatus(`正在使用 ${config.modelName} (Google) 编织文字...`);

    const responseStream = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
        systemInstruction: prompts.systemPrompt,
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
      { role: 'system', content: prompts.systemPrompt },
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
  signal?: AbortSignal
): Promise<string> => {
  ensureNotAborted(signal);
  updateStatus("正在构思润色方案...");
  const config = getConfigForTask('polishing');
  const controls = getPromptControls('polishing', config);
  const prompts = getTaskPrompts('polishing', {
    controls,
    bookTitle: book.title,
    worldSettingSnippet: `${book.worldSetting.slice(0, 200)}...`,
    contextSnippet: context.slice(-500),
    selection,
  });
  const prompt = prompts.userPrompt;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    updateStatus(`使用 ${config.modelName} (Google) 逐字推敲...`);

    const responseStream = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
        systemInstruction: prompts.systemPrompt,
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
      { role: 'system', content: prompts.systemPrompt },
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

/**
 * CHAT: Conversational Assistant
 */
export const chat = async (
  history: { role: 'user' | 'assistant' | 'system', content: string }[],
  context: string,
  onStream: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  ensureNotAborted(signal);
  // Use chat model for chat as it usually requires decent reasoning
  const config = getConfigForTask('chat');
  const controls = getPromptControls('chat', config);
  const dialogue = history
    .map((msg) => {
      if (msg.role === 'assistant') return `助手: ${msg.content}`;
      if (msg.role === 'system') return `系统: ${msg.content}`;
      return `用户: ${msg.content}`;
    })
    .join('\n\n');
  const prompts = getTaskPrompts('chat', {
    controls,
    chatContext: context,
    dialogue,
  });

  const systemMessage = {
    role: 'system' as const,
    content: prompts.systemPrompt,
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
