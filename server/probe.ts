import type { AIModel } from '../src/types.ts';
import { buildOpenAIChatCompletionsUrl, formatOpenAINetworkError } from '../src/services/openaiCompat.ts';

export interface ModelProbeResult {
  provider: 'google' | 'openai';
  modelName: string;
  endpoint: string;
  latencyMs: number;
}

const PROBE_TIMEOUT_MS = 15000;

const resolveProvider = (model: AIModel): 'google' | 'openai' => (
  model.baseUrl && model.baseUrl.trim() ? 'openai' : model.provider
);

const resolveApiKey = (provider: 'google' | 'openai', model: AIModel): string => {
  const envKey = provider === 'google'
    ? (process.env.VITE_GEMINI_API_KEY || process.env.VITE_API_KEY || '')
    : (process.env.VITE_OPENAI_API_KEY || process.env.VITE_API_KEY || '');

  return model.apiKey?.trim() || envKey.trim();
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = PROBE_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const probeOpenAICompat = async (
  modelName: string,
  apiKey: string,
  baseUrl?: string
) => {
  const url = buildOpenAIChatCompletionsUrl(baseUrl);
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: 'You are a connectivity probe. Reply with "ok".' },
          { role: 'user', content: 'ping' },
        ],
        temperature: 0,
        max_tokens: 8,
      }),
    });
  } catch (error) {
    throw formatOpenAINetworkError(error, url);
  }

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`OpenAI 兼容接口返回 ${response.status}: ${raw.slice(0, 300)}`);
  }

  const data = await response.json();
  if (!data?.choices?.[0]?.message?.content) {
    throw new Error('OpenAI 兼容接口返回格式异常，未读取到 choices[0].message.content。');
  }

  return url;
};

const probeGoogle = async (modelName: string, apiKey: string) => {
  const normalizedModel = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${normalizedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 8 },
      }),
    });
  } catch (error: any) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Gemini 接口连接超时（>${PROBE_TIMEOUT_MS}ms）。`);
    }
    throw new Error(`无法连接 Gemini 接口：${error?.message || '未知错误'}`);
  }

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Gemini 接口返回 ${response.status}: ${raw.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Gemini 接口返回格式异常，未读取到 candidates 内容。');
  }

  return url;
};

export const testModelAvailabilityOnServer = async (model: AIModel): Promise<ModelProbeResult> => {
  const modelName = model.modelName?.trim();
  if (!modelName) {
    throw new Error('Model Name 不能为空。');
  }

  const provider = resolveProvider(model);
  const apiKey = resolveApiKey(provider, model);
  if (!apiKey) {
    throw new Error('API Key 未配置。');
  }

  const startedAt = Date.now();
  const endpoint = provider === 'openai'
    ? await probeOpenAICompat(modelName, apiKey, model.baseUrl)
    : await probeGoogle(modelName, apiKey);

  return {
    provider,
    modelName,
    endpoint,
    latencyMs: Date.now() - startedAt,
  };
};
