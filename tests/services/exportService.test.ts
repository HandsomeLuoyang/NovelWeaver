import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { exportAsDocx, exportAsEpub, exportAsMarkdown } from '../../src/services/exportService';
import { createBook, createNode } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  getBookNodes: vi.fn(),
  getFactsArray: vi.fn(),
  getMaterialsArray: vi.fn(),
  getCharacterStatesArray: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  getBookNodes: mocks.getBookNodes,
  db: {
    facts: { where: () => ({ equals: () => ({ toArray: mocks.getFactsArray }) }) },
    materials: { where: () => ({ equals: () => ({ toArray: mocks.getMaterialsArray }) }) },
    characterStates: { where: () => ({ equals: () => ({ toArray: mocks.getCharacterStatesArray }) }) },
  },
}));

describe('exportService', () => {
  beforeEach(() => {
    mocks.getBookNodes.mockReset();
    mocks.getFactsArray.mockReset();
    mocks.getMaterialsArray.mockReset();
    mocks.getCharacterStatesArray.mockReset();
  });

  it('exports markdown with facts, materials and character ledger', async () => {
    const book = createBook({ title: '雾港协议' });
    mocks.getBookNodes.mockResolvedValue([
      createNode({ id: 'v1', type: 'volume', title: '第一卷', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: '弥雾夜', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: '潮汐钟', order: 0 }),
      createNode({ id: 's1', parentId: 'c1', type: 'scene', title: '码头夜巡', summary: '发现异常', content: '正文片段', order: 0, meta: { location: '东码头' } }),
    ]);
    mocks.getFactsArray.mockResolvedValue([{ id: 'f1', bookId: book.id, category: 'rule', statement: '潮汐钟会逆转', notes: '', tags: [], reliability: 'confirmed', locked: true, status: 'active', createdAt: 1, updatedAt: 1 }]);
    mocks.getMaterialsArray.mockResolvedValue([{ id: 'm1', bookId: book.id, type: 'reference', title: '钟楼图纸', content: '图纸显示内部空腔。', tags: [], createdAt: 1, updatedAt: 1 }]);
    mocks.getCharacterStatesArray.mockResolvedValue([{ id: 'cs1', bookId: book.id, nodeId: 's1', characterName: '林秋', location: '东码头', physicalState: '轻伤', knowledgeState: '知道钟楼异常', inventory: '怀表', note: '', updatedAt: 1 }]);

    const markdown = await exportAsMarkdown(book);

    expect(markdown).toContain('事实库');
    expect(markdown).toContain('素材库');
    expect(markdown).toContain('角色状态');
    expect(markdown).toContain('码头夜巡');
  });

  it('exports docx blob and epub archive', async () => {
    const book = createBook({ title: '雾港协议' });
    mocks.getBookNodes.mockResolvedValue([
      createNode({ id: 'v1', type: 'volume', title: '第一卷', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: '弥雾夜', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: '潮汐钟', order: 0 }),
      createNode({ id: 's1', parentId: 'c1', type: 'scene', title: '码头夜巡', summary: '发现异常', content: '正文片段', order: 0 }),
    ]);
    mocks.getFactsArray.mockResolvedValue([]);
    mocks.getMaterialsArray.mockResolvedValue([]);
    mocks.getCharacterStatesArray.mockResolvedValue([]);

    const docxBlob = await exportAsDocx(book);
    const epubBytes = await exportAsEpub(book);
    expect(() => unzipSync(epubBytes as Uint8Array)).not.toThrow();

    expect(docxBlob).toBeInstanceOf(Blob);
    expect(docxBlob.size).toBeGreaterThan(0);
    expect(epubBytes).toBeInstanceOf(Uint8Array);
    expect(epubBytes[0]).toBe(80);
    expect(epubBytes[1]).toBe(75);
    expect(epubBytes.length).toBeGreaterThan(100);
  });
});
