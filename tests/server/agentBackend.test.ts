// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIReviewItem } from '../../src/types.ts';
import type { AgentRun, AgentToolScope } from '../../shared/agent.ts';

const executeAITaskMock = vi.fn();

vi.mock('../../server/ai.ts', () => ({
  executeAITask: executeAITaskMock,
}));

const ALL_AGENT_SCOPES: AgentToolScope[] = [
  'project.read',
  'project.write.content',
  'project.write.structure',
  'project.write.metadata',
  'ai.run',
  'review.apply',
  'export.run',
  'ops.rollback',
  'models.read',
  'models.admin',
];

type BackendModules = {
  tempDir: string;
  store: typeof import('../../server/store.ts');
  tools: typeof import('../../server/tools.ts');
};

let activeTempDir = '';

const makeActor = (scopes: AgentToolScope[]) => ({
  actorType: 'agent' as const,
  actorId: 'test-agent',
  scopes,
});

const loadBackend = async (): Promise<BackendModules> => {
  vi.resetModules();
  activeTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zmj-agent-'));
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
  const chapter = store.createNode(snapshot, {
    bookId: book.id,
    parentId: null,
    type: 'chapter',
    title: '第一章',
    summary: '章节摘要',
    status: 'outlined',
  });
  const scene = store.createNode(snapshot, {
    bookId: book.id,
    parentId: chapter.id,
    type: 'scene',
    title: '场景一',
    summary: '场景摘要',
    content: '旧正文。',
    status: 'drafted',
  });
  store.refreshBookWordCount(snapshot, book.id);
  return { bookId: book.id, chapterId: chapter.id, sceneId: scene.id };
}).result;

describe.sequential('agent-ready backend', () => {
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
        // Database file can remain locked briefly in node:sqlite during teardown.
      }
      activeTempDir = '';
    }
  });

  it('rejects tool invocation when scopes are missing', async () => {
    const { tools } = await loadBackend();

    await expect(
      tools.invokeTool(
        'write.update_node_content',
        { args: { nodeId: 'node-1', content: '新的正文' } },
        { actor: makeActor(['project.read']) }
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('supports dryRun without mutating content, checkpoints or journals', async () => {
    const { store, tools } = await loadBackend();
    const { sceneId } = seedBook(store);

    const response = await tools.invokeTool(
      'write.update_node_content',
      { args: { nodeId: sceneId, content: '试运行正文' }, dryRun: true },
      { actor: makeActor(['project.write.content']) }
    ) as unknown as { ok: boolean; dryRun: boolean; checkpointId?: string };

    const snapshot = store.getContentSnapshot();
    const node = store.findNode(snapshot, sceneId);

    expect(response.ok).toBe(true);
    expect(response.dryRun).toBe(true);
    expect(response.checkpointId).toBeUndefined();
    expect(node?.content).toBe('旧正文。');
    expect(snapshot.checkpoints).toHaveLength(0);
    expect(snapshot.history).toHaveLength(0);
    expect(store.listOperationJournal()).toHaveLength(0);
  });

  it('records checkpoint, journal and history once for idempotent direct writes', async () => {
    const { store, tools } = await loadBackend();
    const { bookId, sceneId } = seedBook(store);

    const actor = makeActor(['project.write.content', 'ops.rollback']);
    const request = {
      args: { nodeId: sceneId, content: '第一次落稿正文，足够长以触发 drafted 状态。' },
      idempotencyKey: 'same-write',
      returnMode: 'full' as const,
    };

    const first = await tools.invokeTool('write.update_node_content', request, { actor }) as unknown as {
      checkpointId?: string;
      result: { nodeId: string; wordCount: number; status: string };
    };
    const second = await tools.invokeTool('write.update_node_content', request, { actor }) as unknown as typeof first;

    const snapshot = store.getContentSnapshot();
    const node = store.findNode(snapshot, sceneId);
    const journal = store.listOperationJournal();

    expect(second).toEqual(first);
    expect(node?.content).toContain('第一次落稿正文');
    expect(node?.status).toBe('outlined');
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.checkpoints[0]?.bookId).toBe(bookId);
    expect(snapshot.history).toHaveLength(1);
    expect(journal).toHaveLength(1);
    expect(journal[0]?.toolName).toBe('write.update_node_content');
    expect(first.checkpointId).toBeTruthy();
  });

  it('applies review items through the shared write pipeline', async () => {
    const { store, tools } = await loadBackend();
    const { bookId, sceneId } = seedBook(store);
    const reviewId = 'review-1';
    const reviewItem: AIReviewItem = {
      id: reviewId,
      taskId: 'task-1',
      type: 'draft',
      bookId,
      nodeId: sceneId,
      nodeTitle: '场景一',
      source: 'direct',
      status: 'pending',
      createdAt: Date.now(),
      payload: {
        kind: 'text',
        mode: 'draft',
        originalContent: '旧正文。',
        generatedContent: 'AI 审阅落稿正文。',
      },
    };
    store.saveReviewItem(reviewItem);

    await tools.invokeTool(
      'write.apply_review_item',
      { args: { reviewId }, returnMode: 'full' },
      { actor: makeActor(['review.apply']) }
    );

    const snapshot = store.getContentSnapshot();
    const node = store.findNode(snapshot, sceneId);
    const appliedReview = store.getReviewItem(reviewId);
    const journal = store.listOperationJournal();

    expect(node?.content).toBe('AI 审阅落稿正文。');
    expect(appliedReview?.status).toBe('applied');
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.history[0]?.action).toBe('ai-draft');
    expect(journal[0]?.toolName).toBe('write.apply_review_item');
  });

  it('creates proposal review items for ai tools without mutating content', async () => {
    executeAITaskMock.mockResolvedValue({ kind: 'text', content: '<POLISHED>润色后的正文</POLISHED>' });
    const { store, tools } = await loadBackend();
    const { bookId, sceneId } = seedBook(store);

    const result = await tools.invokeTool(
      'ai.polish_text',
      { args: { bookId, nodeId: sceneId, selection: '旧正文' }, returnMode: 'full' },
      { actor: makeActor(['ai.run', 'project.write.content']) }
    ) as unknown as { reviewItemId: string; content: string };

    const snapshot = store.getContentSnapshot();
    const node = store.findNode(snapshot, sceneId);
    const reviews = store.listReviewItems(bookId);

    expect(result.reviewItemId).toBeTruthy();
    expect(result.content).toContain('润色后的正文');
    expect(node?.content).toBe('旧正文。');
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.status).toBe('pending');
    expect(store.listOperationJournal()).toHaveLength(0);
  });

  it('allows ai apply mode to write content and mark journal entries as ai-generated', async () => {
    executeAITaskMock.mockResolvedValue({ kind: 'text', content: 'AI 直接写入的新正文，长度足够超过五十字以模拟完整草稿输出。AI 继续补充内容，确保状态切换到 drafted。' });
    const { store, tools } = await loadBackend();
    const { bookId, sceneId } = seedBook(store);

    const response = await tools.invokeTool(
      'ai.draft_scene',
      { args: { bookId, nodeId: sceneId, applyMode: 'apply' }, returnMode: 'full' },
      { actor: makeActor(['ai.run', 'project.write.content']) }
    ) as unknown as { result: { nodeId: string; wordCount: number; content: string } };

    const snapshot = store.getContentSnapshot();
    const node = store.findNode(snapshot, sceneId);
    const journal = store.listOperationJournal();

    expect(response.result.content).toContain('AI 直接写入的新正文');
    expect(node?.content).toContain('AI 直接写入的新正文');
    expect(node?.status).toBe('drafted');
    expect(snapshot.checkpoints).toHaveLength(1);
    expect(snapshot.history[0]?.action).toBe('ai-draft');
    expect(journal[0]?.toolName).toBe('ai.draft_scene');
    expect(journal[0]?.isAI).toBe(true);
  });

  it('updates agent runs with step logs for tool executions', async () => {
    const { store, tools } = await loadBackend();
    seedBook(store);
    const run: AgentRun = {
      id: 'run-1',
      goal: '读取全库概览',
      caller: 'openclaw',
      status: 'running',
      steps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.saveAgentRun(run);

    await tools.invokeTool(
      'read.project_overview',
      { sessionId: run.id, returnMode: 'summary' },
      { actor: makeActor(['project.read']) }
    );

    const savedRun = store.getAgentRun(run.id);
    expect(savedRun?.status).toBe('completed');
    expect(savedRun?.steps).toHaveLength(1);
    expect(savedRun?.steps[0]?.toolName).toBe('read.project_overview');
    expect(savedRun?.steps[0]?.status).toBe('completed');
  });
});
