import { afterEach, describe, expect, it, vi } from 'vitest';
import { testModelAvailability } from '../../src/services/modelProbe';
import { AIModel } from '../../src/types';

const createModel = (patch: Partial<AIModel>): AIModel => ({
  id: 'm-1',
  name: 'test-model',
  provider: 'google',
  apiKey: 'test-key',
  modelName: 'gemini-1.5-flash',
  ...patch,
});

describe('modelProbe', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tests OpenAI compatible endpoint when baseUrl is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const model = createModel({
      baseUrl: 'https://api.example.com/v1',
      modelName: 'gpt-4o-mini',
    });
    const result = await testModelAvailability(model);

    expect(result.provider).toBe('openai');
    expect(result.endpoint).toBe('https://api.example.com/v1/chat/completions');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('tests Gemini endpoint when no baseUrl is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const model = createModel({
      modelName: 'gemini-1.5-flash',
    });
    const result = await testModelAvailability(model);

    expect(result.provider).toBe('google');
    expect(result.endpoint).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws clear error when endpoint returns non-200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid key',
    });
    vi.stubGlobal('fetch', fetchMock as any);

    const model = createModel({
      baseUrl: 'https://api.example.com/v1',
      modelName: 'gpt-4o-mini',
    });

    await expect(testModelAvailability(model)).rejects.toThrow('OpenAI 兼容接口返回 401');
  });
});
