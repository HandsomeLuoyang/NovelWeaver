import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Book, StoryNode, NodeType } from '../types';
import { GenesisResponse, ExpansionResponse, GenesisResponseSchema, ExpansionResponseSchema } from '../schemas';
import { useStore } from '../store';

// Type definitions for internal task identification
type TaskType = 'genesis' | 'expansion' | 'drafting' | 'polishing' | 'chat';
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
  const baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';

  // Some providers use /chat/completions, others might just be the base (careful with double slash)
  // Usually user provides "https://api.deepseek.com", so we append "/chat/completions"
  // If they provided the full path, we might need to be smarter, but standard is base URL.
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

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
    throw error;
  }
}

async function* callOpenAIStream(
  config: { apiKey: string, baseUrl?: string, modelName: string, temperature: number },
  messages: { role: string, content: string }[],
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  ensureNotAborted(signal);
  const baseUrl = config.baseUrl ? config.baseUrl.replace(/\/+$/, '') : 'https://api.openai.com/v1';
  const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;

  const response = await fetch(url, {
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

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Stream Error ${response.status}: ${err}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
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
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
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

  const systemPrompt = "你是'织梦机'创世引擎。你将灵感种子培育成参天大树。请全程使用中文回答。";
  const userContent = `
       你是一位世界级的通俗小说家和金牌编辑。

       ${controls}
       
       用户灵感: "${userPrompt}"
       
       任务:
       1. 起一个吸引人的中文书名。
       2. 将灵感扩写为 300 字的核心梗概（类似封底简介）。
       3. 定义世界观设定/规则（200 字）。
       4. 创造 5 个有深度且有秘密的主要角色。
       5. 规划故事的第一层级（卷/部）。通常为 3-5 卷。
       
       请确保所有输出均为简体中文。
     `;

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

  const prompt = `
    [角色] 你是网文界的大神级作家，擅长构建严密的剧情结构。

    ${controls}

    [全局上下文]
    书名: ${book.title}
    核心梗概: ${book.premise}
    主要角色: ${book.characters.map(c => c.name + ': ' + c.role).join(', ')}

    [当前焦点]
    当前层级: ${getNodeTypeName(parentNode.type)}
    当前标题: ${parentNode.title}
    当前剧情梗概: ${parentNode.summary}

    [任务]
    请将上述 "${parentNode.title}" 拆解扩写为 5-10 个 "${getNodeTypeName(childType)}" (子节点)。
    
    要求：
    1. 这一系列的子节点必须能够完整讲述父节点概括的故事。
    2. 节奏要紧凑，富有冲突。
    3. 子节点的摘要(summary)应作为下一层级写作的具体指令，越具体越好。
    4. 请严格使用简体中文。
  `;

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
        temperature: config.temperature,
      },
    } as any);

    const text = response.text;
    if (!text) throw new Error("AI 未返回数据");
    return ExpansionResponseSchema.parse(JSON.parse(text));
  } else {
    // OpenAI Logic
    updateStatus(`正在使用 ${config.modelName} (OpenAI) 构建下层结构...`);
    const messages = [
      { role: 'system', content: "请返回 JSON 格式：{ \"nodes\": [{ \"title\": \"...\", \"summary\": \"...\" }] }" },
      { role: 'user', content: prompt }
    ];

    const text = await callOpenAI(config, messages, false, signal);
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

  const prompt = `
    [Role] 你是白金级畅销小说家。请根据以下全方位上下文撰写正文。

    ${controls}

    === 1. 宏观世界 (World Bible) ===
    书名: ${book.title}
    核心梗概: ${book.premise}
    世界观设定: ${book.worldSetting}
    主要角色表: ${JSON.stringify(book.characters.map(c => ({ name: c.name, role: c.role, description: c.description })))}

    === 2. 剧情脉络 (Structural Context) ===
    (从上至下，你是这棵故事树的末端叶子)
    ${hierarchyContext}

    === 3. 近期记忆 (Linear Memory) ===
    (这是之前发生的剧情，请保持连贯)
    ${linearContext ? linearContext : "（这是故事的开篇）"}

    === 4. 检索记忆 (Semantic Recall) ===
    (与当前任务语义最相关的历史片段)
    ${semanticContext ? semanticContext : "（未命中高相关历史片段）"}

    === 5. 当前任务 (Writing Instruction) ===
    当前场景标题: ${node.title}
    当前场景细纲: ${node.summary}

    === 写作要求 ===
    1. **一致性**: 严格遵守世界观和角色设定，不要吃书。
    2. **连贯性**: 紧密承接[近期记忆]的剧情和文风。
    3. **画面感**: 使用"Show, don't tell"技法，多描写感官细节。
    4. **节奏**: 这一段落应有起伏，字数控制在 1000-2000 字。
    5. **格式**: 使用 Markdown 格式。
    6. **语言**: 简体中文。
  `;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    updateStatus(`正在使用 ${config.modelName} (Google) 编织文字...`);

    const responseStream = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
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
    updateStatus("写作完成");
    return fullText;
  } else {
    // OpenAI Logic
    updateStatus(`正在使用 ${config.modelName} (OpenAI) 编织文字...`);
    const messages = [
      { role: 'system', content: "你是白金级畅销小说家。" },
      { role: 'user', content: prompt }
    ];

    let fullText = "";
    for await (const chunk of callOpenAIStream(config, messages, signal)) {
      fullText += chunk;
      onStream(chunk);
    }
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

  const prompt = `
        [角色] 你是专业的文学编辑和润色专家。

        ${controls}
        
        [背景信息]
        书名: ${book.title}
        世界观风格: ${book.worldSetting.slice(0, 200)}...
        
        [上下文片段]
        ${context.slice(-500)}
        
        [待润色文本]
        "${selection}"
        
        [任务]
        请重写并润色上述 [待润色文本]。
        要求：
        1. 提升文采，使其更有画面感和感染力。
        2. 修复语病，优化句子节奏。
        3. 保持原意不变，但可以适当扩写细节以增强沉浸感。
        4. 仅返回润色后的文本，不要包含任何解释。
    `;

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    updateStatus(`使用 ${config.modelName} (Google) 逐字推敲...`);

    const responseStream = await ai.models.generateContentStream({
      model: config.modelName,
      contents: prompt,
      config: {
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
    updateStatus("润色完成");
    return fullText;
  } else {
    // OpenAI Logic
    updateStatus(`使用 ${config.modelName} (OpenAI) 逐字推敲...`);
    const messages = [
      { role: 'system', content: "你是专业的文学编辑和润色专家。" },
      { role: 'user', content: prompt }
    ];

    let fullText = "";
    for await (const chunk of callOpenAIStream(config, messages, signal)) {
      fullText += chunk;
      onStream(chunk);
    }
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

  const systemMessage = {
    role: 'system',
    content: `你是一个专业的写作助手。请根据提供的世界观和当前上下文回答用户的问题。

    ${controls}

    [当前上下文]
    ${context}

    请用简洁、有帮助的语气回答。如果用户让你写一段内容，请保持与当前文风一致。`
  };

  if (config.provider === 'google') {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const dialogue = history
      .map((msg) => {
        if (msg.role === 'assistant') return `助手: ${msg.content}`;
        if (msg.role === 'system') return `系统: ${msg.content}`;
        return `用户: ${msg.content}`;
      })
      .join('\n\n');

    const prompt = `
${systemMessage.content}

[对话历史]
${dialogue}

[任务]
请基于以上上下文，继续回答最后一个用户问题。回答需简洁、可执行。
`;

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
    return fullText;

  } else {
    // OpenAI Logic
    const messages = [
      systemMessage,
      ...history.map(h => ({ role: h.role, content: h.content }))
    ];

    let fullText = "";
    for await (const chunk of callOpenAIStream(config, messages, signal)) {
      fullText += chunk;
      onStream(chunk);
    }
    return fullText;
  }
};
