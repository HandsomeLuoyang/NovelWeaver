import { db } from '../../db';
import { FactEntry, ForeshadowEntry } from '../../types';
import { NovelWeaverPlugin } from '../types';

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const planningToolkitPlugin: NovelWeaverPlugin = {
  id: 'builtin.planning-toolkit',
  name: 'Planning Toolkit',
  version: '1.0.0',
  category: 'planning',
  description: '规划助手：从选区快速生成伏笔和事实记录。',
  actions: [
    {
      id: 'planning.seedForeshadowFromSelection',
      title: '从选区生成伏笔',
      description: '把当前选中文字或节点摘要快速沉淀为一条伏笔记录。',
      requires: ['book', 'scene'],
      contextHint: '需要打开一本书并选中一个场景；优先使用选中文本。',
      run: async ({ currentBook, currentNode, selectedText }) => {
        if (!currentBook || !currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点。' };
        }
        const seed = (selectedText || currentNode.summary || currentNode.title).trim();
        if (!seed) {
          return { message: '当前没有可用文本，无法生成伏笔。' };
        }
        const now = Date.now();
        const entry: ForeshadowEntry = {
          id: createId(),
          bookId: currentBook.id,
          title: seed.slice(0, 24),
          notes: seed,
          tags: ['快捷创建'],
          setupNodeId: currentNode.id,
          payoffNodeId: undefined,
          status: 'seeded',
          createdAt: now,
          updatedAt: now,
        };
        await db.foreshadows.put(entry);
        return { message: '已从当前内容创建伏笔。' };
      },
    },
    {
      id: 'planning.captureFactFromSelection',
      title: '从选区沉淀事实',
      description: '把选中文字或节点摘要保存为一条待确认事实。',
      requires: ['book', 'scene'],
      contextHint: '需要打开一本书并选中一个场景；优先使用选中文本。',
      run: async ({ currentBook, currentNode, selectedText }) => {
        if (!currentBook || !currentNode) {
          return { message: '请先打开书籍并选中节点。' };
        }
        const statement = (selectedText || currentNode.summary).trim();
        if (!statement) {
          return { message: '当前没有可沉淀的事实文本。' };
        }
        const now = Date.now();
        const entry: FactEntry = {
          id: createId(),
          bookId: currentBook.id,
          category: 'custom',
          statement,
          notes: '由插件从当前节点快捷沉淀，建议后续补充分组与标签。',
          tags: ['快捷创建'],
          sourceNodeId: currentNode.id,
          sourceExcerpt: statement.slice(0, 120),
          reliability: 'tentative',
          locked: false,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        await db.facts.put(entry);
        return { message: '已添加到事实库（待确认）。' };
      },
    },
  ],
};
