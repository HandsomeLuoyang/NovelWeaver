import { describe, expect, it } from 'vitest';
import {
  buildOpenAIChatCompletionsUrl,
  formatOpenAINetworkError,
  normalizeOpenAIBaseUrl,
} from '../../services/openaiCompat';

describe('openai url helpers', () => {
  it('uses OpenAI default base url when empty', () => {
    expect(normalizeOpenAIBaseUrl()).toBe('https://api.openai.com/v1');
  });

  it('auto prepends https when protocol is missing', () => {
    expect(normalizeOpenAIBaseUrl('api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1');
  });

  it('keeps relative proxy paths untouched', () => {
    expect(normalizeOpenAIBaseUrl('/api/openai-proxy')).toBe('/api/openai-proxy');
  });

  it('appends chat/completions only once', () => {
    expect(buildOpenAIChatCompletionsUrl('https://example.com/v1')).toBe('https://example.com/v1/chat/completions');
    expect(buildOpenAIChatCompletionsUrl('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/chat/completions');
  });
});

describe('formatOpenAINetworkError', () => {
  it('maps failed fetch into actionable message', () => {
    const mapped = formatOpenAINetworkError(new TypeError('Failed to fetch'), 'https://example.com/v1/chat/completions');
    expect(mapped.message).toContain('无法连接模型接口');
    expect(mapped.message).toContain('https://example.com/v1/chat/completions');
    expect(mapped.message).toContain('Base URL');
  });
});
