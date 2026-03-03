const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const normalizeOpenAIBaseUrl = (rawBaseUrl?: string): string => {
  const trimmed = (rawBaseUrl || '').trim();
  if (!trimmed) return DEFAULT_OPENAI_BASE_URL;

  const withProtocol = (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/'))
    ? trimmed
    : `https://${trimmed}`;

  return withProtocol.replace(/\/+$/, '');
};

export const buildOpenAIChatCompletionsUrl = (rawBaseUrl?: string): string => {
  const baseUrl = normalizeOpenAIBaseUrl(rawBaseUrl);
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
};

export const formatOpenAINetworkError = (error: unknown, url: string): Error => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return error;
  }

  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
    return new Error(
      `无法连接模型接口：${url}\n请检查 Base URL（需包含 http/https）、网络连通性、代理与 CORS 配置。`
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error('调用 OpenAI 兼容接口失败。');
};
