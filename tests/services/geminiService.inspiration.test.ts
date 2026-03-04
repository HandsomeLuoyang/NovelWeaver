import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInspirationPack } from '../../services/geminiService';
import { useStore } from '../../store';
import { AIModel, ModelConfig, PromptProfile, StoryNode } from '../../types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('geminiService inspiration pack', () => {
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

  it('parses structured inspiration pack from openai response', async () => {
    const model: AIModel = {
      id: 'openai-inspiration-model',
      name: 'OpenAI Inspiration',
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://example-openai.local/v1',
      modelName: 'gpt-4o-mini',
    };

    useStore.setState({
      models: [model],
      modelConfig: {
        ...clone(initialModelConfig),
        genesisModelId: model.id,
        expansionModelId: model.id,
        draftingModelId: model.id,
        polishingModelId: model.id,
        chatModelId: model.id,
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/chat/completions')) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    direction: '让主角主动出击，抢先调查夜港爆炸真相',
                    nextBeats: ['主角偷入档案库', '发现矛盾证词', '决定夜访嫌疑人'],
                    conflictEscalations: ['嫌疑人先下手', '证据被栽赃', '盟友立场动摇'],
                    twists: ['幕后人竟是导师', '被害者并未死亡', '爆炸是障眼法'],
                    dialogueHooks: ['“你看到的不一定是真的。”', '“你以为你在追凶，其实你在被引导。”', '“今晚之后，我们只能活一个。”'],
                    sensoryAnchors: ['铁锈味混着潮气', '远处警笛被海雾吞没', '玻璃碎片在路灯下发冷光'],
                    cliffhangers: ['门外传来第二把钥匙转动声', '她手机里突然弹出“你已经迟了”', '楼下传来熟悉的脚步声'],
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

    const node: StoryNode = {
      id: 'scene-1',
      bookId: 'book-1',
      parentId: 'chapter-1',
      type: 'scene',
      title: '夜港对峙',
      summary: '主角发现爆炸案线索，但被神秘人盯上',
      content: '她盯着燃烧后的码头，风里有一股刺鼻焦味。',
      status: 'outlined',
      order: 0,
    };

    const pack = await generateInspirationPack(
      node,
      {
        id: 'book-1',
        title: '测试书',
        premise: '城市阴谋与成长',
        worldSetting: '近未来港城',
        characters: [],
        wordCount: 0,
        createdAt: Date.now(),
      },
      [],
      '前文A',
      '检索B'
    );

    expect(pack.direction.length).toBeGreaterThan(0);
    expect(pack.nextBeats.length).toBeGreaterThan(0);
    expect(pack.twists.length).toBeGreaterThan(0);
    expect(pack.dialogueHooks[0]).toContain('你看到');
  });
});
