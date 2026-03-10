// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolScope } from '../../shared/agent.ts';

const executeAITaskMock = vi.fn();

vi.mock('../../server/ai.ts', () => ({
  executeAITask: executeAITaskMock,
}));

type BackendModules = {
  tempDir: string;
  store: typeof import('../../server/store.ts');
  tools: typeof import('../../server/tools.ts');
};

let activeTempDir = '';

const makeActor = (scopes: AgentToolScope[]) => ({
  actorType: 'agent' as const,
  actorId: 'content-agent',
  scopes,
});

const loadBackend = async (): Promise<BackendModules> => {
  vi.resetModules();
  activeTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zmj-content-'));
  process.env.AGENT_DATA_DIR = activeTempDir;
  process.env.AGENT_BOOTSTRAP_TOKEN = 'test-bootstrap-token';

  const store = await import('../../server/store.ts');
  const tools = await import('../../server/tools.ts');
  return { tempDir: activeTempDir, store, tools };
};

const seedBook = (store: BackendModules['store']) => store.withContentMutation((snapshot) => {
  const book = store.createBook(snapshot, {
    title: '测试书',
    premise: '一句话前提',
    worldSetting: '世界设定',
    characters: [],
  });
  const chapterA = store.createNode(snapshot, {
    bookId: book.id,
    parentId: null,
    type: 'chapter',
    title: '第一章',
    summary: '章节摘要',
    status: 'outlined',
  });
  const chapterB = store.createNode(snapshot, {
    bookId: book.id,
    parentId: null,
    type: 'chapter',
    title: '第二章',
    summary: '备用章节',
    status: 'outlined',
    order: 1,
  });
  const scene = store.createNode(snapshot, {
    bookId: book.id,
    parentId: chapterA.id,
    type: 'scene',
    title: '场景一',
    summary: '夜雨里的追逐',
    content: '旧正文。',
    status: 'drafted',
  });
  store.refreshBookWordCount(snapshot, book.id);
  return { bookId: book.id, chapterAId: chapterA.id, chapterBId: chapterB.id, sceneId: scene.id };
}).result;

describe.sequential('content governance tools', () => {
  beforeEach(() => {
    executeAITaskMock.mockReset();
  });

  afterEach(() => {
    delete process.env.AGENT_DATA_DIR;
    delete process.env.AGENT_BOOTSTRAP_TOKEN;
    if (activeTempDir) {
      try {
        fs.rmSync(activeTempDir, { recursive: true, force: true });
      } catch {
        // ignore sqlite file teardown races
      }
      activeTempDir = '';
    }
  });

  it('creates and updates books, then exposes checkpoints', async () => {
    const { store, tools } = await loadBackend();

    const created = await tools.invokeTool(
      'write.create_book',
      {
        args: {
          title: '新书计划',
          premise: '少年与旧神交易。',
          worldSetting: '海雾都市',
          characters: [{ name: '林雾', role: '主角', description: '负债少年', secret: '见过神' }],
          initialVolumes: [{ title: '第一卷', summary: '交易开始' }],
        },
        returnMode: 'full',
      },
      { actor: makeActor(['project.write.structure']) }
    ) as unknown as { result: { book: { id: string; title: string } } };

    const bookId = created.result.book.id;

    const updated = await tools.invokeTool(
      'write.update_book',
      {
        args: {
          bookId,
          bookPatch: {
            title: '新书计划·改',
            worldSetting: '被潮汐吞没的海雾都市',
          },
        },
        returnMode: 'full',
      },
      { actor: makeActor(['project.write.metadata']) }
    ) as unknown as { result: { book: { title: string; worldSetting: string } } };

    const checkpoints = await tools.invokeTool(
      'read.checkpoints',
      { args: { bookId } },
      { actor: makeActor(['project.read']) }
    ) as { items: Array<{ bookId: string }> };

    const snapshot = store.getContentSnapshot();
    const book = store.findBook(snapshot, bookId);
    const topNodes = store.getBookNodes(snapshot, bookId).filter((node) => node.parentId === null);

    expect(book?.title).toBe('新书计划·改');
    expect(updated.result.book.worldSetting).toContain('海雾都市');
    expect(topNodes).toHaveLength(1);
    expect(topNodes[0]?.title).toBe('第一卷');
    expect(checkpoints.items.length).toBeGreaterThanOrEqual(2);
  });

  it('searches nodes and returns node history', async () => {
    const { store, tools } = await loadBackend();
    const { bookId, sceneId } = seedBook(store);

    await tools.invokeTool(
      'write.update_node_content',
      { args: { nodeId: sceneId, content: '第一次改稿，雨夜追逐变成巷战。' } },
      { actor: makeActor(['project.write.content']) }
    );
    await tools.invokeTool(
      'write.update_node_content',
      { args: { nodeId: sceneId, content: '第二次改稿，雨夜追逐里出现失控列车。' } },
      { actor: makeActor(['project.write.content']) }
    );

    const search = await tools.invokeTool(
      'read.search_nodes',
      { args: { bookId, query: '失控列车' } },
      { actor: makeActor(['project.read']) }
    ) as { items: Array<{ nodeId: string; excerpt: string }> };

    const history = await tools.invokeTool(
      'read.node_history',
      { args: { nodeId: sceneId } },
      { actor: makeActor(['project.read']) }
    ) as { items: Array<{ content: string }> };

    expect(search.items[0]?.nodeId).toBe(sceneId);
    expect(search.items[0]?.excerpt).toContain('失控列车');
    expect(history.items).toHaveLength(2);
    expect(history.items.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('第一次改稿'),
        expect.stringContaining('第二次改稿'),
      ])
    );
  });

  it('moves nodes, deletes them into recycle bin, and restores them', async () => {
    const { store, tools } = await loadBackend();
    const { bookId, chapterBId, sceneId } = seedBook(store);

    const moved = await tools.invokeTool(
      'write.move_node',
      { args: { nodeId: sceneId, newParentId: chapterBId, newOrder: 0 }, returnMode: 'full' },
      { actor: makeActor(['project.write.structure']) }
    ) as unknown as { result: { parentId: string | null } };

    expect(moved.result.parentId).toBe(chapterBId);

    const deleted = await tools.invokeTool(
      'write.delete_node',
      { args: { nodeId: sceneId }, returnMode: 'full' },
      { actor: makeActor(['project.write.structure']) }
    ) as unknown as { result: { recycleEntryId: string; deletedCount: number } };

    const deletedNodes = await tools.invokeTool(
      'read.deleted_nodes',
      { args: { bookId } },
      { actor: makeActor(['project.read']) }
    ) as { items: Array<{ id: string; rootNodeId: string }> };

    expect(deleted.result.deletedCount).toBe(1);
    expect(deletedNodes.items[0]?.id).toBe(deleted.result.recycleEntryId);
    expect(store.findNode(store.getContentSnapshot(), sceneId)).toBeNull();

    const restored = await tools.invokeTool(
      'write.restore_node',
      { args: { entryId: deleted.result.recycleEntryId }, returnMode: 'full' },
      { actor: makeActor(['project.write.structure']) }
    ) as unknown as { result: { nodeId: string; restoredCount: number } };

    const restoredNode = store.findNode(store.getContentSnapshot(), restored.result.nodeId);
    expect(restored.result.restoredCount).toBe(1);
    expect(restoredNode?.parentId).toBe(chapterBId);
    expect(store.listDeletedNodes(store.getContentSnapshot(), bookId)).toHaveLength(0);
  });

  it('upserts material, foreshadow, character state and reference records', async () => {
    const { store, tools } = await loadBackend();
    const { bookId, sceneId } = seedBook(store);

    await tools.invokeTool(
      'write.upsert_material',
      {
        args: {
          material: {
            bookId,
            type: 'idea',
            title: '列车失控',
            content: '列车撞进旧城墙。',
            tags: ['追逐'],
            source: '灵感',
            linkedNodeId: sceneId,
          },
        },
      },
      { actor: makeActor(['project.write.metadata']) }
    );

    await tools.invokeTool(
      'write.upsert_foreshadow',
      {
        args: {
          foreshadow: {
            bookId,
            title: '车站钟声',
            notes: '与终局相关',
            tags: ['终局'],
            setupNodeId: sceneId,
            status: 'seeded',
          },
        },
      },
      { actor: makeActor(['project.write.metadata']) }
    );

    await tools.invokeTool(
      'write.upsert_character_state',
      {
        args: {
          state: {
            bookId,
            nodeId: sceneId,
            characterName: '林雾',
            location: '旧站台',
            physicalState: '左臂擦伤',
            knowledgeState: '知道钟声来自地下',
            inventory: '车票',
            note: '情绪失控',
          },
        },
      },
      { actor: makeActor(['project.write.metadata']) }
    );

    await tools.invokeTool(
      'write.upsert_character_state',
      {
        args: {
          state: {
            bookId,
            nodeId: sceneId,
            characterName: '林雾',
            location: '旧站台',
            physicalState: '左臂包扎后恢复行动',
            knowledgeState: '知道钟声来自地下',
            inventory: '车票',
            note: '情绪稳定',
          },
        },
      },
      { actor: makeActor(['project.write.metadata']) }
    );

    await tools.invokeTool(
      'write.upsert_reference',
      {
        args: {
          reference: {
            bookId,
            entityType: 'material',
            entityId: 'material-virtual',
            nodeId: sceneId,
            excerpt: '列车撞进旧城墙。',
          },
        },
      },
      { actor: makeActor(['project.write.metadata']) }
    );

    const snapshot = store.getContentSnapshot();
    expect(store.getBookMaterials(snapshot, bookId)).toHaveLength(1);
    expect(store.getBookForeshadows(snapshot, bookId)).toHaveLength(1);
    expect(store.getBookCharacterStates(snapshot, bookId)).toHaveLength(1);
    expect(store.getBookCharacterStates(snapshot, bookId)[0]?.physicalState).toContain('包扎');
    expect(store.getBookReferences(snapshot, bookId)).toHaveLength(1);
  });
});
