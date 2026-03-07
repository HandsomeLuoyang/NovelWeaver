import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildProjectQaContext } from '../../src/services/projectQaService';
import { createBook, createNode } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  getNode: vi.fn(),
  getFactsArray: vi.fn(),
  getMaterialsArray: vi.fn(),
  getAncestors: vi.fn(),
  getLinearContext: vi.fn(),
  getSemanticContext: vi.fn(),
  getSceneCharacterStates: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: {
    nodes: { get: mocks.getNode },
    facts: { where: () => ({ equals: () => ({ toArray: mocks.getFactsArray }) }) },
    materials: { where: () => ({ equals: () => ({ toArray: mocks.getMaterialsArray }) }) },
  },
  getAncestors: mocks.getAncestors,
  getLinearContext: mocks.getLinearContext,
  getSemanticContext: mocks.getSemanticContext,
  getSceneCharacterStates: mocks.getSceneCharacterStates,
}));

describe('buildProjectQaContext', () => {
  beforeEach(() => {
    mocks.getNode.mockReset();
    mocks.getFactsArray.mockReset();
    mocks.getMaterialsArray.mockReset();
    mocks.getAncestors.mockReset();
    mocks.getLinearContext.mockReset();
    mocks.getSemanticContext.mockReset();
    mocks.getSceneCharacterStates.mockReset();
  });

  it('builds project-focused context with retrieved sources', async () => {
    const book = createBook({
      title: '雾港协议',
      premise: '治安官调查港口连环失踪案。',
      worldSetting: '蒸汽港口城，存在潮汐占卜。',
      characters: [{ name: '林秋', role: '治安官', description: '冷静缜密', secret: '真正身份来自外海' }],
    });
    const activeNode = createNode({
      id: 'scene-1',
      bookId: book.id,
      type: 'scene',
      title: '码头夜巡',
      summary: '林秋发现失踪案与潮汐钟有关。',
      content: '林秋在码头发现潮汐钟异常。',
    });

    mocks.getNode.mockResolvedValue(activeNode);
    mocks.getFactsArray.mockResolvedValue([
      {
        id: 'fact-1',
        bookId: book.id,
        category: 'rule',
        statement: '潮汐钟每七夜会逆转一次。',
        notes: '旧港守则',
        tags: ['潮汐钟'],
        reliability: 'confirmed',
        locked: true,
        status: 'active',
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    mocks.getMaterialsArray.mockResolvedValue([
      {
        id: 'material-1',
        bookId: book.id,
        type: 'reference',
        title: '旧港钟楼笔记',
        content: '钟楼内部存在逆流结构。',
        tags: ['钟楼'],
        linkedNodeId: activeNode.id,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    mocks.getAncestors.mockResolvedValue([
      createNode({ id: 'chapter-1', type: 'chapter', title: '第一章', summary: '失踪案发酵', order: 0 }),
    ]);
    mocks.getLinearContext.mockResolvedValue('前文提到第七夜会起雾。');
    mocks.getSemanticContext.mockResolvedValue('[相关场景: 潮汐祭礼]\n有人在祭礼上看见逆流。');
    mocks.getSceneCharacterStates.mockResolvedValue([
      {
        id: 'ledger-1',
        bookId: book.id,
        nodeId: activeNode.id,
        characterName: '林秋',
        location: '东码头',
        physicalState: '轻伤',
        knowledgeState: '已知潮汐钟异常',
        inventory: '怀表',
        note: '',
        updatedAt: 3,
      },
    ]);

    const result = await buildProjectQaContext(book, '潮汐钟为什么异常？', activeNode.id);

    expect(result.context).toContain('项目问答模式');
    expect(result.context).toContain('潮汐钟每七夜会逆转一次');
    expect(result.context).toContain('旧港钟楼笔记');
    expect(result.context).toContain('码头夜巡');
    expect(result.context).toContain('角色状态账本');
    expect(result.sources.some((source) => source.label.includes('当前节点'))).toBe(true);
    expect(result.sources.some((source) => source.label.includes('事实'))).toBe(true);
  });
});
