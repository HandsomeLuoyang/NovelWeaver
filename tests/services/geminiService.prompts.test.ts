import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { genesis } from '../../src/services/geminiService';
import { useStore } from '../../src/store';
import { createDefaultPromptProfile } from '../../src/services/promptProfiles';
import { AIModel, ModelConfig, PromptProfile } from '../../src/types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('geminiService prompt profile integration', () => {
  let initialModels: AIModel[];
  let initialModelConfig: ModelConfig;
  let initialPromptProfiles: PromptProfile[];
  let initialActivePromptProfileId: string;

  beforeEach(() => {
    const state = useStore.getState();
    initialModels = clone(state.models);
    initialModelConfig = clone(state.modelConfig);
    initialPromptProfiles = clone(state.promptProfiles);
    initialActivePromptProfileId = state.activePromptProfileId;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useStore.setState({
      models: initialModels,
      modelConfig: initialModelConfig,
      promptProfiles: initialPromptProfiles,
      activePromptProfileId: initialActivePromptProfileId,
    });
  });

  it('uses active prompt profile templates in genesis(openai) flow', async () => {
    const model: AIModel = {
      id: 'openai-test-model',
      name: 'OpenAI Test',
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://example-openai.local/v1',
      modelName: 'gpt-4o-mini',
    };

    const profile = createDefaultPromptProfile();
    profile.id = 'custom-profile';
    profile.name = '自定义';
    profile.isBuiltin = false;
    profile.templates.genesis.systemPrompt = 'SYS::{{userPrompt}}';
    profile.templates.genesis.userPrompt = 'USR::{{userPrompt}}::{{controls}}';

    useStore.setState({
      models: [model],
      modelConfig: {
        ...clone(initialModelConfig),
        genesisModelId: model.id,
        expansionModelId: model.id,
        draftingModelId: model.id,
        polishingModelId: model.id,
        chatModelId: model.id,
        enableCreativitySeeds: false,
        enableQualityCheck: false,
      },
      promptProfiles: [profile],
      activePromptProfileId: profile.id,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/chat/completions')) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: '测试书名',
                    premise: '测试梗概',
                    worldSetting: '测试世界观',
                    characters: [
                      { name: '甲', role: '主角', description: '描述', secret: '秘密' },
                    ],
                    initialVolumes: [
                      { title: '第一卷', summary: '卷摘要' },
                    ],
                  }),
                },
              },
            ],
          }),
          text: async () => '',
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ state: {}, version: 0 }),
        text: async () => '',
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await genesis('灵感输入');
    expect(result.title).toBe('测试书名');

    const openAICall = fetchMock.mock.calls.find(([input]) => String(input).includes('/chat/completions'));
    expect(openAICall).toBeTruthy();

    const body = JSON.parse(String(openAICall?.[1]?.body || '{}')) as { messages?: Array<{ role: string; content: string }> };
    expect(body.messages?.[0]?.content).toContain('SYS::灵感输入');
    expect(body.messages?.[1]?.content).toContain('USR::灵感输入::');
  });
});
