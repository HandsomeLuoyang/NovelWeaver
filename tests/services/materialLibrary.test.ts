import { describe, expect, it } from 'vitest';
import { buildMaterialPromptContext } from '../../src/services/materialLibrary';
import { MaterialEntry } from '../../src/types';

const createMaterial = (overrides: Partial<MaterialEntry>): MaterialEntry => ({
  id: overrides.id || `m-${Math.random()}`,
  bookId: overrides.bookId || 'book-1',
  type: overrides.type || 'note',
  title: overrides.title || '默认素材',
  content: overrides.content || '默认内容',
  tags: overrides.tags || [],
  source: overrides.source,
  linkedNodeId: overrides.linkedNodeId,
  createdAt: overrides.createdAt || Date.now(),
  updatedAt: overrides.updatedAt || Date.now(),
});

describe('materialLibrary service', () => {
  it('returns fallback context when no materials exist', () => {
    const context = buildMaterialPromptContext([], '港口追逐');
    expect(context.selected).toHaveLength(0);
    expect(context.materialSummary).toContain('素材库为空');
    expect(context.materialContext).toContain('暂无素材');
  });

  it('ranks materials by query relevance', () => {
    const materials = [
      createMaterial({
        id: 'm1',
        type: 'idea',
        title: '港口追逐桥段',
        content: '在暴雨中的港口追逐，利用吊桥制造压迫感。',
        tags: ['动作', '追逐'],
        updatedAt: 100,
      }),
      createMaterial({
        id: 'm2',
        type: 'reference',
        title: '宫廷对话语气',
        content: '重礼节和隐喻的对话模板。',
        tags: ['对白'],
        updatedAt: 200,
      }),
    ];

    const context = buildMaterialPromptContext(materials, '港口动作追逐', 1);
    expect(context.selected).toHaveLength(1);
    expect(context.selected[0].id).toBe('m1');
    expect(context.materialContext).toContain('港口追逐桥段');
  });

  it('falls back to recency order when query is empty', () => {
    const materials = [
      createMaterial({ id: 'old', updatedAt: 10 }),
      createMaterial({ id: 'new', updatedAt: 20 }),
    ];
    const context = buildMaterialPromptContext(materials, '', 1);
    expect(context.selected[0].id).toBe('new');
  });
});
