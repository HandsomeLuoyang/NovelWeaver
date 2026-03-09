import { randomUUID } from 'node:crypto';
import type { AIReviewItem, FactEntry, StoryNode } from '../src/types.ts';
import type { AgentRun, AgentToolDefinition, AgentToolInvokeRequest, AgentToolScope, OperationJournalEntry } from '../shared/agent.ts';
import { executeAITask } from './ai.ts';
import {
  appendOperationJournal,
  createBook,
  createCheckpoint,
  createNode,
  findBook,
  findNode,
  getAgentRun,
  getBookCharacterStates,
  getBookFacts,
  getBookMaterials,
  getBookNodes,
  getContentSnapshot,
  getIdempotentResponse,
  getReviewItem,
  getSettingsSnapshot,
  listOperationJournal,
  listReviewItems,
  rollbackCheckpoint,
  saveAgentRun,
  saveContentSnapshot,
  saveHistoryEntry,
  saveIdempotentResponse,
  saveReviewItem,
  upsertFact,
  updateReviewItemStatus,
  withContentMutation,
  refreshBookWordCount,
} from './store.ts';
import {
  buildDocxBufferFromBundle,
  buildEpubBufferFromBundle,
  buildHtmlFromBundle,
  buildMarkdownFromBundle,
  buildTextFromBundle,
} from './export.ts';
import type { ExportBundle } from './export.ts';

export interface ToolActor {
  actorType: OperationJournalEntry['actorType'];
  actorId: string;
  scopes: AgentToolScope[];
}

export interface ToolInvokeContext {
  actor: ToolActor;
}

const createId = () => randomUUID();

const hasScope = (actor: ToolActor, scope: AgentToolScope) => actor.scopes.includes(scope);

const buildBundle = (bookId: string): ExportBundle => {
  const snapshot = getContentSnapshot();
  const book = findBook(snapshot, bookId);
  if (!book) throw new Error('书籍不存在');
  return {
    book,
    nodes: getBookNodes(snapshot, bookId),
    facts: getBookFacts(snapshot, bookId),
    materials: getBookMaterials(snapshot, bookId),
    characterStates: getBookCharacterStates(snapshot, bookId),
  };
};

const buildReviewItem = (input: Omit<AIReviewItem, 'id' | 'createdAt' | 'status'>): AIReviewItem => ({
  id: createId(),
  createdAt: Date.now(),
  status: 'pending',
  ...input,
});

const createJournalEntry = (
  actor: ToolActor,
  toolName: string,
  changes: OperationJournalEntry['entityChanges'],
  checkpointId?: string,
  isAI = false
): OperationJournalEntry => ({
  id: createId(),
  actorType: actor.actorType,
  actorId: actor.actorId,
  toolName,
  entityChanges: changes,
  checkpointId,
  isAI,
  createdAt: Date.now(),
});

const shouldCreateCheckpoint = (actor: ToolActor, checkpointPolicy: AgentToolInvokeRequest['checkpointPolicy'] | undefined) => {
  if (checkpointPolicy === 'force') return true;
  if (checkpointPolicy === 'skip') return !hasScope(actor, 'ops.rollback');
  return true;
};

const withMutation = <T>(
  toolName: string,
  actor: ToolActor,
  options: AgentToolInvokeRequest,
  mutate: (snapshot: ReturnType<typeof getContentSnapshot>) => { result: T; changes: OperationJournalEntry['entityChanges']; checkpointBookId?: string | null }
) => {
  if (options.idempotencyKey) {
    const existing = getIdempotentResponse(options.idempotencyKey);
    if (existing && existing.toolName === toolName) {
      return existing.response as T;
    }
  }

  const originalSnapshot = getContentSnapshot();
  const working = structuredClone(originalSnapshot);
  const { result, changes, checkpointBookId } = mutate(working);
  let checkpointId: string | undefined;

  if (!options.dryRun) {
    if (checkpointBookId && shouldCreateCheckpoint(actor, options.checkpointPolicy)) {
      checkpointId = createCheckpoint(working, checkpointBookId, `[Agent] ${toolName} 自动版本点`).id;
    }
    saveContentSnapshot(working);
    appendOperationJournal(createJournalEntry(actor, toolName, changes, checkpointId, toolName.startsWith('ai.')));
  }

  const response = options.returnMode === 'summary'
    ? { ok: true, dryRun: Boolean(options.dryRun), checkpointId, summary: changes.map((item) => item.summary) }
    : { ok: true, dryRun: Boolean(options.dryRun), checkpointId, result };

  if (!options.dryRun && options.idempotencyKey) {
    saveIdempotentResponse(toolName, options.idempotencyKey, response);
  }

  return response as T;
};

const normalizeSelection = (original: string, selectedText: string, polishedSegment: string) => {
  const candidates = Array.from(new Set([selectedText, selectedText.trim()])).filter(Boolean);
  for (const candidate of candidates) {
    const index = original.indexOf(candidate);
    if (index >= 0) {
      return `${original.slice(0, index)}${polishedSegment}${original.slice(index + candidate.length)}`;
    }
  }
  return polishedSegment;
};

const parsePolishedSegment = (raw: string) => {
  const match = raw.match(/<POLISHED>([\s\S]*?)<\/POLISHED>/i);
  return (match?.[1] || raw).trim();
};

const appendRunStep = (sessionId: string | undefined, toolName: string, summary: string, status: AgentRun['status'], error?: string) => {
  if (!sessionId) return;
  const run = getAgentRun(sessionId);
  if (!run) return;
  const step = {
    id: createId(),
    toolName,
    status: error ? 'failed' as const : 'completed' as const,
    summary,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    error,
  };
  run.steps.push(step);
  run.status = status;
  run.updatedAt = Date.now();
  run.error = error;
  saveAgentRun(run);
};

export const TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'read.project_overview',
    description: '读取全库概览和每本书的基础统计。',
    scopes: ['project.read'],
    sideEffect: false,
    inputSchema: {},
    outputSchema: { books: 'Book[]' },
  },
  {
    name: 'read.book_tree',
    description: '读取指定书籍的节点树、事实库、素材库和角色账本摘要。',
    scopes: ['project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string' },
    outputSchema: { book: 'Book', nodes: 'StoryNode[]' },
  },
  {
    name: 'read.node_context',
    description: '读取节点上下文，包括祖先结构、前文、相关场景、事实和素材。',
    scopes: ['project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string', nodeId: 'string' },
    outputSchema: { node: 'StoryNode', ancestors: 'StoryNode[]', linearContext: 'string', semanticContext: 'string' },
  },
  {
    name: 'read.review_items',
    description: '读取待审阅结果。',
    scopes: ['project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string?' },
    outputSchema: { items: 'AIReviewItem[]' },
  },
  {
    name: 'write.update_node_content',
    description: '直接更新节点正文，并自动记历史与版本点。',
    scopes: ['project.write.content'],
    sideEffect: true,
    inputSchema: { nodeId: 'string', content: 'string' },
    outputSchema: { nodeId: 'string', wordCount: 'number' },
  },
  {
    name: 'write.update_node_summary',
    description: '更新节点摘要。',
    scopes: ['project.write.metadata'],
    sideEffect: true,
    inputSchema: { nodeId: 'string', summary: 'string' },
    outputSchema: { nodeId: 'string' },
  },
  {
    name: 'write.create_child_node',
    description: '在指定父节点下创建新子节点。',
    scopes: ['project.write.structure'],
    sideEffect: true,
    inputSchema: { parentId: 'string', title: 'string', summary: 'string', type: 'NodeType?' },
    outputSchema: { node: 'StoryNode' },
  },
  {
    name: 'write.update_node_meta',
    description: '更新节点元数据。',
    scopes: ['project.write.metadata'],
    sideEffect: true,
    inputSchema: { nodeId: 'string', metaPatch: 'object' },
    outputSchema: { nodeId: 'string', meta: 'StoryNode.meta' },
  },
  {
    name: 'write.upsert_fact',
    description: '新增或更新事实条目。',
    scopes: ['project.write.metadata'],
    sideEffect: true,
    inputSchema: { fact: 'FactEntry' },
    outputSchema: { fact: 'FactEntry' },
  },
  {
    name: 'write.apply_review_item',
    description: '应用审阅项结果到正文或结构。',
    scopes: ['review.apply'],
    sideEffect: true,
    inputSchema: { reviewId: 'string' },
    outputSchema: { reviewId: 'string', status: 'applied' },
  },
  {
    name: 'ops.create_checkpoint',
    description: '为指定书籍创建版本点。',
    scopes: ['ops.rollback'],
    sideEffect: true,
    inputSchema: { bookId: 'string', name: 'string?' },
    outputSchema: { checkpointId: 'string' },
  },
  {
    name: 'ops.rollback_checkpoint',
    description: '回滚到指定版本点。',
    scopes: ['ops.rollback'],
    sideEffect: true,
    inputSchema: { checkpointId: 'string' },
    outputSchema: { checkpointId: 'string' },
  },
  {
    name: 'ops.export_book',
    description: '导出整本书为多种格式。',
    scopes: ['export.run'],
    sideEffect: false,
    inputSchema: { bookId: 'string', format: 'json|markdown|text|html|docx|epub' },
    outputSchema: { filename: 'string', mimeType: 'string', content: 'string|base64' },
  },
  {
    name: 'ops.operation_journal',
    description: '读取最近操作日志。',
    scopes: ['project.read'],
    sideEffect: false,
    inputSchema: { limit: 'number?' },
    outputSchema: { entries: 'OperationJournalEntry[]' },
  },
  {
    name: 'ai.generate_book',
    description: '基于一句话灵感生成新书结构。',
    scopes: ['ai.run', 'project.write.structure'],
    sideEffect: true,
    inputSchema: { userPrompt: 'string', applyMode: 'proposal|apply?' },
    outputSchema: { reviewItemId: 'string?' },
  },
  {
    name: 'ai.expand_node',
    description: '为结构节点生成下一层级。',
    scopes: ['ai.run', 'project.write.structure'],
    sideEffect: true,
    inputSchema: { bookId: 'string', nodeId: 'string', applyMode: 'proposal|apply?' },
    outputSchema: { nodes: 'Array<{title,summary}>' },
  },
  {
    name: 'ai.draft_scene',
    description: '为场景生成草稿。',
    scopes: ['ai.run', 'project.write.content'],
    sideEffect: true,
    inputSchema: { bookId: 'string', nodeId: 'string', applyMode: 'proposal|apply?' },
    outputSchema: { content: 'string' },
  },
  {
    name: 'ai.polish_text',
    description: '润色场景正文或选区。',
    scopes: ['ai.run', 'project.write.content'],
    sideEffect: true,
    inputSchema: { bookId: 'string', nodeId: 'string', selection: 'string?', applyMode: 'proposal|apply?' },
    outputSchema: { content: 'string' },
  },
  {
    name: 'ai.rewrite_scene',
    description: '为选中文本生成多个改写版本。',
    scopes: ['ai.run'],
    sideEffect: false,
    inputSchema: { bookId: 'string', selection: 'string', preContext: 'string', postContext: 'string', variantCount: 'number?' },
    outputSchema: { variants: 'string[]' },
  },
  {
    name: 'ai.project_qa',
    description: '基于项目资料回答问题。',
    scopes: ['ai.run', 'project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string', query: 'string', activeNodeId: 'string?' },
    outputSchema: { answer: 'string', sources: 'Array<{label,nodeId?}>' },
  },
  {
    name: 'ai.creative_rescue',
    description: '提供卡文急救方案。',
    scopes: ['ai.run'],
    sideEffect: false,
    inputSchema: { bookId: 'string', nodeId: 'string', problem: 'string?' },
    outputSchema: { direction: 'string', nextBeats: 'string[]' },
  },
  {
    name: 'ai.check_consistency',
    description: '执行一致性检查。',
    scopes: ['ai.run', 'project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string' },
    outputSchema: { findings: 'ConsistencyFinding[]' },
  },
  {
    name: 'ai.analyze_pacing',
    description: '执行节奏诊断。',
    scopes: ['ai.run', 'project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string' },
    outputSchema: { report: 'PacingReport' },
  },
  {
    name: 'ai.build_publish_pack',
    description: '生成发布工作流包。',
    scopes: ['ai.run', 'project.read'],
    sideEffect: false,
    inputSchema: { bookId: 'string' },
    outputSchema: { report: 'PublishWorkflowReport', markdown: 'string' },
  },
];

const getTool = (name: string) => {
  const tool = TOOL_DEFINITIONS.find((item) => item.name === name);
  if (!tool) throw new Error(`未知工具：${name}`);
  return tool;
};

const ensureToolScope = (toolName: string, actor: ToolActor) => {
  const tool = getTool(toolName);
  const missing = tool.scopes.filter((scope) => !hasScope(actor, scope));
  if (missing.length > 0) {
    const error = new Error(`缺少作用域：${missing.join(', ')}`);
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }
  return tool;
};

const buildNodeContext = (bookId: string, nodeId: string) => {
  const snapshot = getContentSnapshot();
  const book = findBook(snapshot, bookId);
  const node = findNode(snapshot, nodeId);
  if (!book || !node) throw new Error('书籍或节点不存在');
  const nodes = getBookNodes(snapshot, bookId);
  const nodeMap = new Map(nodes.map((entry) => [entry.id, entry]));
  const ancestors: StoryNode[] = [];
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  const facts = getBookFacts(snapshot, bookId);
  const materials = getBookMaterials(snapshot, bookId);
  const characterStates = getBookCharacterStates(snapshot, bookId).filter((entry) => entry.nodeId === nodeId);
  return { book, node, nodes, ancestors, facts, materials, characterStates };
};

export const invokeTool = async (
  toolName: string,
  request: AgentToolInvokeRequest,
  context: ToolInvokeContext
) => {
  ensureToolScope(toolName, context.actor);
  const args = request.args || {};

  try {
    if (toolName === 'read.project_overview') {
      const snapshot = getContentSnapshot();
      const books = snapshot.books.map((book) => {
        const nodes = getBookNodes(snapshot, book.id);
        return {
          ...book,
          nodeCount: nodes.length,
          sceneCount: nodes.filter((node) => node.type === 'scene').length,
          draftedSceneCount: nodes.filter((node) => node.type === 'scene' && (node.content || '').trim().length > 50).length,
          factCount: getBookFacts(snapshot, book.id).length,
          materialCount: getBookMaterials(snapshot, book.id).length,
        };
      });
      appendRunStep(request.sessionId, toolName, `读取 ${books.length} 本书概览`, 'completed');
      return request.returnMode === 'summary' ? { books: books.map((book) => ({ id: book.id, title: book.title, nodeCount: book.nodeCount })) } : { books };
    }

    if (toolName === 'read.book_tree') {
      const bookId = String(args.bookId || '');
      const snapshot = getContentSnapshot();
      const book = findBook(snapshot, bookId);
      if (!book) throw new Error('书籍不存在');
      const result = {
        book,
        nodes: getBookNodes(snapshot, bookId),
        facts: getBookFacts(snapshot, bookId),
        materials: getBookMaterials(snapshot, bookId),
        characterStates: getBookCharacterStates(snapshot, bookId),
        checkpoints: snapshot.checkpoints.filter((entry) => entry.bookId === bookId),
      };
      appendRunStep(request.sessionId, toolName, `读取书籍《${book.title}》结构树`, 'completed');
      return request.returnMode === 'summary'
        ? { book: { id: book.id, title: book.title }, nodeCount: result.nodes.length }
        : result;
    }

    if (toolName === 'read.node_context') {
      const { book, node, ancestors, nodes, facts, materials, characterStates } = buildNodeContext(String(args.bookId || ''), String(args.nodeId || ''));
      const linearContext = nodes
        .filter((entry) => entry.type === 'scene')
        .sort((a, b) => a.order - b.order)
        .slice(0, 3)
        .map((entry) => `${entry.title}\n${entry.content || entry.summary}`)
        .join('\n\n');
      appendRunStep(request.sessionId, toolName, `读取节点「${node.title}」上下文`, 'completed');
      return request.returnMode === 'summary'
        ? { node: { id: node.id, title: node.title }, ancestorCount: ancestors.length, factCount: facts.length }
        : { book, node, ancestors, linearContext, facts, materials, characterStates };
    }

    if (toolName === 'read.review_items') {
      const bookId = args.bookId ? String(args.bookId) : undefined;
      const items = listReviewItems(bookId);
      appendRunStep(request.sessionId, toolName, `读取 ${items.length} 条审阅项`, 'completed');
      return { items };
    }

    if (toolName === 'ops.operation_journal') {
      const limit = Math.min(200, Math.max(1, Number(args.limit || 50)));
      const entries = listOperationJournal(limit);
      appendRunStep(request.sessionId, toolName, `读取 ${entries.length} 条操作日志`, 'completed');
      return { entries };
    }

    if (toolName === 'write.update_node_content') {
      const nodeId = String(args.nodeId || '');
      const content = String(args.content || '');
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const node = findNode(snapshot, nodeId);
        if (!node) throw new Error('节点不存在');
        node.content = content;
        node.status = content.trim().length > 50 ? 'drafted' : 'outlined';
        saveHistoryEntry(snapshot, node.id, content, 'manual');
        const wordCount = refreshBookWordCount(snapshot, node.bookId);
        return {
          result: { nodeId: node.id, wordCount, status: node.status },
          checkpointBookId: node.bookId,
          changes: [{
            entityType: 'node',
            entityId: node.id,
            bookId: node.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `更新正文：${node.title}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, `更新节点正文 ${nodeId}`, 'completed');
      return response;
    }

    if (toolName === 'write.update_node_summary') {
      const nodeId = String(args.nodeId || '');
      const summary = String(args.summary || '');
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const node = findNode(snapshot, nodeId);
        if (!node) throw new Error('节点不存在');
        node.summary = summary;
        return {
          result: { nodeId: node.id, summary: node.summary },
          checkpointBookId: node.bookId,
          changes: [{
            entityType: 'node',
            entityId: node.id,
            bookId: node.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `更新摘要：${node.title}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, `更新节点摘要 ${nodeId}`, 'completed');
      return response;
    }

    if (toolName === 'write.create_child_node') {
      const parentId = String(args.parentId || '');
      const title = String(args.title || '');
      const summary = String(args.summary || '');
      const requestedType = args.type ? String(args.type) as StoryNode['type'] : undefined;
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const parent = findNode(snapshot, parentId);
        if (!parent) throw new Error('父节点不存在');
        const nextType = requestedType || (parent.type === 'volume' ? 'arc' : parent.type === 'arc' ? 'chapter' : 'scene');
        const node = createNode(snapshot, {
          bookId: parent.bookId,
          parentId: parent.id,
          type: nextType,
          title,
          summary,
          status: 'empty',
        });
        parent.status = 'outlined';
        return {
          result: { node },
          checkpointBookId: parent.bookId,
          changes: [{
            entityType: 'node',
            entityId: node.id,
            bookId: node.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `新增子节点：${node.title}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, `新增子节点 ${title}`, 'completed');
      return response;
    }

    if (toolName === 'write.update_node_meta') {
      const nodeId = String(args.nodeId || '');
      const metaPatch = (args.metaPatch || {}) as Record<string, unknown>;
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const node = findNode(snapshot, nodeId);
        if (!node) throw new Error('节点不存在');
        node.meta = { ...(node.meta || {}), ...metaPatch };
        return {
          result: { nodeId: node.id, meta: node.meta },
          checkpointBookId: node.bookId,
          changes: [{
            entityType: 'node',
            entityId: node.id,
            bookId: node.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `更新元数据：${node.title}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, `更新节点元数据 ${nodeId}`, 'completed');
      return response;
    }

    if (toolName === 'write.upsert_fact') {
      const fact = args.fact as FactEntry;
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const payload: FactEntry = {
          ...fact,
          id: fact.id || createId(),
          createdAt: fact.createdAt || Date.now(),
          updatedAt: Date.now(),
        };
        upsertFact(snapshot, payload);
        return {
          result: { fact: payload },
          checkpointBookId: payload.bookId,
          changes: [{
            entityType: 'fact',
            entityId: payload.id,
            bookId: payload.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `更新事实：${payload.statement.slice(0, 32)}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, '更新事实库条目', 'completed');
      return response;
    }

    if (toolName === 'write.apply_review_item') {
      const reviewId = String(args.reviewId || '');
      const reviewItem = getReviewItem(reviewId);
      if (!reviewItem) throw new Error('审阅项不存在');
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const node = findNode(snapshot, reviewItem.nodeId);
        if (!node) throw new Error('节点不存在');
        const payload = reviewItem.payload;
        if (payload.kind === 'expansion') {
          payload.nodes.forEach((entry) => {
            createNode(snapshot, {
              bookId: reviewItem.bookId,
              parentId: reviewItem.nodeId,
              type: payload.childType,
              title: entry.title,
              summary: entry.summary,
              status: 'empty',
            });
          });
          node.status = 'outlined';
        } else {
          node.content = payload.generatedContent;
          node.status = payload.generatedContent.trim().length > 50 ? 'drafted' : 'outlined';
          saveHistoryEntry(snapshot, node.id, payload.generatedContent, payload.mode === 'draft' ? 'ai-draft' : 'ai-polish');
          refreshBookWordCount(snapshot, node.bookId);
        }
        return {
          result: { reviewId, status: 'applied' as const },
          checkpointBookId: reviewItem.bookId,
          changes: [{
            entityType: 'review',
            entityId: reviewId,
            bookId: reviewItem.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `应用审阅项：${reviewItem.nodeTitle}`,
          }],
        };
      });
      if (!request.dryRun) updateReviewItemStatus(reviewId, 'applied');
      appendRunStep(request.sessionId, toolName, `应用审阅项 ${reviewId}`, 'completed');
      return response;
    }

    if (toolName === 'ops.create_checkpoint') {
      const bookId = String(args.bookId || '');
      const name = String(args.name || `手动版本点 ${new Date().toLocaleString()}`);
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const checkpoint = createCheckpoint(snapshot, bookId, name);
        return {
          result: { checkpointId: checkpoint.id, checkpoint },
          checkpointBookId: null,
          changes: [{
            entityType: 'checkpoint',
            entityId: checkpoint.id,
            bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `创建版本点：${checkpoint.name}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, `创建版本点 ${name}`, 'completed');
      return response;
    }

    if (toolName === 'ops.rollback_checkpoint') {
      const checkpointId = String(args.checkpointId || '');
      const response = withMutation(toolName, context.actor, request, (snapshot) => {
        const checkpoint = rollbackCheckpoint(snapshot, checkpointId);
        return {
          result: { checkpointId: checkpoint.id, bookId: checkpoint.bookId },
          checkpointBookId: checkpoint.bookId,
          changes: [{
            entityType: 'checkpoint',
            entityId: checkpoint.id,
            bookId: checkpoint.bookId,
            beforeVersion: null,
            afterVersion: null,
            summary: `回滚到版本点：${checkpoint.name}`,
          }],
        };
      });
      appendRunStep(request.sessionId, toolName, `回滚版本点 ${checkpointId}`, 'completed');
      return response;
    }

    if (toolName === 'ops.export_book') {
      const bookId = String(args.bookId || '');
      const format = String(args.format || 'markdown');
      const bundle = buildBundle(bookId);
      let filename = `${bundle.book.title}`;
      let mimeType = 'text/plain;charset=utf-8';
      let content = '';
      if (format === 'json') {
        filename += '.json';
        mimeType = 'application/json';
        content = JSON.stringify(bundle, null, 2);
      } else if (format === 'markdown') {
        filename += '.md';
        mimeType = 'text/markdown;charset=utf-8';
        content = buildMarkdownFromBundle(bundle);
      } else if (format === 'text') {
        filename += '.txt';
        mimeType = 'text/plain;charset=utf-8';
        content = buildTextFromBundle(bundle);
      } else if (format === 'html') {
        filename += '.html';
        mimeType = 'text/html;charset=utf-8';
        content = buildHtmlFromBundle(bundle);
      } else if (format === 'docx') {
        filename += '.docx';
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        content = (await buildDocxBufferFromBundle(bundle)).toString('base64');
      } else if (format === 'epub') {
        filename += '.epub';
        mimeType = 'application/epub+zip';
        content = Buffer.from(buildEpubBufferFromBundle(bundle)).toString('base64');
      } else {
        throw new Error(`不支持的导出格式：${format}`);
      }
      appendRunStep(request.sessionId, toolName, `导出 ${bundle.book.title} 为 ${format}`, 'completed');
      return { filename, mimeType, content, isBase64: format === 'docx' || format === 'epub' };
    }

    if (toolName === 'ai.generate_book') {
      const applyMode = String(args.applyMode || 'proposal');
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'genesis',
        input: { userPrompt: String(args.userPrompt || ''), promptProfileId: args.promptProfileId },
      });
      if (result.kind !== 'genesis') throw new Error('生成结果类型不正确');

      if (applyMode === 'apply') {
        const response = withMutation(toolName, context.actor, request, (snapshot) => {
          const book = createBook(snapshot, {
            title: result.title,
            premise: result.premise,
            worldSetting: result.worldSetting,
            characters: result.characters,
          });
          result.initialVolumes.forEach((entry) => {
            createNode(snapshot, {
              bookId: book.id,
              parentId: null,
              type: 'volume',
              title: entry.title,
              summary: entry.summary,
              status: 'empty',
            });
          });
          return {
            result: { bookId: book.id, title: book.title },
            checkpointBookId: book.id,
            changes: [{
              entityType: 'book',
              entityId: book.id,
              bookId: book.id,
              beforeVersion: null,
              afterVersion: null,
              summary: `创建书籍：${book.title}`,
            }],
          };
        });
        appendRunStep(request.sessionId, toolName, `直接创建新书 ${result.title}`, 'completed');
        return response;
      }

      const reviewItem = buildReviewItem({
        taskId: createId(),
        type: 'expansion',
        bookId: 'genesis',
        nodeId: 'genesis',
        nodeTitle: result.title,
        promptProfileId: String(args.promptProfileId || ''),
        source: 'direct',
        payload: {
          kind: 'expansion',
          childType: 'volume',
          nodes: result.initialVolumes,
        },
      });
      saveReviewItem(reviewItem);
      appendRunStep(request.sessionId, toolName, `生成新书提案 ${result.title}`, 'completed');
      return { proposal: result, reviewItemId: reviewItem.id };
    }

    if (toolName === 'ai.expand_node') {
      const bookId = String(args.bookId || '');
      const nodeId = String(args.nodeId || '');
      const applyMode = String(args.applyMode || 'proposal');
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'expansion',
        input: { bookId, nodeId, childType: args.childType, promptProfileId: args.promptProfileId, contextOverrides: args.contextOverrides },
      });
      if (result.kind !== 'expansion') throw new Error('扩写结果类型不正确');
      const snapshot = getContentSnapshot();
      const node = findNode(snapshot, nodeId);
      if (!node) throw new Error('节点不存在');

      if (applyMode === 'apply') {
        const response = withMutation(toolName, context.actor, request, (working) => {
          const target = findNode(working, nodeId);
          if (!target) throw new Error('节点不存在');
          result.nodes.forEach((entry) => {
            createNode(working, {
              bookId,
              parentId: nodeId,
              type: result.childType,
              title: entry.title,
              summary: entry.summary,
              status: 'empty',
            });
          });
          target.status = 'outlined';
          return {
            result: { childType: result.childType, count: result.nodes.length, nodes: result.nodes },
            checkpointBookId: bookId,
            changes: [{
              entityType: 'node',
              entityId: nodeId,
              bookId,
              beforeVersion: null,
              afterVersion: null,
              summary: `AI 扩写子节点：${target.title}`,
            }],
          };
        });
        appendRunStep(request.sessionId, toolName, `直接扩写 ${node.title}`, 'completed');
        return response;
      }

      const reviewItem = buildReviewItem({
        taskId: createId(),
        type: 'expansion',
        bookId,
        nodeId,
        nodeTitle: node.title,
        promptProfileId: String(args.promptProfileId || ''),
        source: 'direct',
        payload: {
          kind: 'expansion',
          childType: result.childType,
          nodes: result.nodes,
        },
      });
      saveReviewItem(reviewItem);
      appendRunStep(request.sessionId, toolName, `生成扩写提案 ${node.title}`, 'completed');
      return { reviewItemId: reviewItem.id, nodes: result.nodes, childType: result.childType };
    }

    if (toolName === 'ai.draft_scene' || toolName === 'ai.polish_text') {
      const bookId = String(args.bookId || '');
      const nodeId = String(args.nodeId || '');
      const applyMode = String(args.applyMode || 'proposal');
      const node = findNode(getContentSnapshot(), nodeId);
      if (!node) throw new Error('节点不存在');
      const taskType = toolName === 'ai.draft_scene' ? 'drafting' : 'polishing';
      const aiResult = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType,
        input: {
          bookId,
          nodeId,
          selection: args.selection,
          polishRange: args.selection ? 'selection' : 'scene',
          promptProfileId: args.promptProfileId,
          contextOverrides: args.contextOverrides,
        },
      });
      if (aiResult.kind !== 'text') throw new Error('AI 返回格式错误');

      const generatedContent = toolName === 'ai.polish_text' && args.selection
        ? normalizeSelection(node.content || '', String(args.selection || ''), parsePolishedSegment(aiResult.content))
        : (toolName === 'ai.polish_text' ? parsePolishedSegment(aiResult.content) : aiResult.content);

      if (applyMode === 'apply') {
        const response = withMutation(toolName, context.actor, request, (snapshot) => {
          const target = findNode(snapshot, nodeId);
          if (!target) throw new Error('节点不存在');
          target.content = generatedContent;
          target.status = generatedContent.trim().length > 50 ? 'drafted' : 'outlined';
          saveHistoryEntry(snapshot, target.id, generatedContent, toolName === 'ai.draft_scene' ? 'ai-draft' : 'ai-polish');
          const wordCount = refreshBookWordCount(snapshot, bookId);
          return {
            result: { nodeId, wordCount, content: generatedContent },
            checkpointBookId: bookId,
            changes: [{
              entityType: 'node',
              entityId: nodeId,
              bookId,
              beforeVersion: null,
              afterVersion: null,
              summary: `${toolName === 'ai.draft_scene' ? 'AI 起草' : 'AI 润色'}：${target.title}`,
            }],
          };
        });
        appendRunStep(request.sessionId, toolName, `${toolName === 'ai.draft_scene' ? '直接起草' : '直接润色'} ${node.title}`, 'completed');
        return response;
      }

      const reviewItem = buildReviewItem({
        taskId: createId(),
        type: toolName === 'ai.draft_scene' ? 'draft' : 'polish',
        bookId,
        nodeId,
        nodeTitle: node.title,
        promptProfileId: String(args.promptProfileId || ''),
        source: 'direct',
        payload: {
          kind: 'text',
          mode: toolName === 'ai.draft_scene' ? 'draft' : 'polish',
          originalContent: node.content || '',
          generatedContent,
        },
      });
      saveReviewItem(reviewItem);
      appendRunStep(request.sessionId, toolName, `${toolName === 'ai.draft_scene' ? '生成草稿提案' : '生成润色提案'} ${node.title}`, 'completed');
      return { reviewItemId: reviewItem.id, content: generatedContent };
    }

    if (toolName === 'ai.rewrite_scene') {
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'rewrite',
        input: {
          bookId: args.bookId,
          selection: args.selection,
          preContext: args.preContext,
          postContext: args.postContext,
          variantCount: args.variantCount,
          promptProfileId: args.promptProfileId,
        },
      });
      appendRunStep(request.sessionId, toolName, '生成改写版本', 'completed');
      return result;
    }

    if (toolName === 'ai.project_qa') {
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'project_qa',
        input: {
          bookId: args.bookId,
          query: args.query,
          activeNodeId: args.activeNodeId,
          promptProfileId: args.promptProfileId,
        },
      });
      appendRunStep(request.sessionId, toolName, '执行项目问答', 'completed');
      return result;
    }

    if (toolName === 'ai.creative_rescue') {
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'creative_rescue',
        input: {
          bookId: args.bookId,
          nodeId: args.nodeId,
          problem: args.problem,
        },
      });
      appendRunStep(request.sessionId, toolName, '执行卡文急救', 'completed');
      return result;
    }

    if (toolName === 'ai.check_consistency') {
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'consistency',
        input: { bookId: args.bookId },
      });
      appendRunStep(request.sessionId, toolName, '执行一致性检查', 'completed');
      return result;
    }

    if (toolName === 'ai.analyze_pacing') {
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'pacing',
        input: { bookId: args.bookId },
      });
      appendRunStep(request.sessionId, toolName, '执行节奏分析', 'completed');
      return result;
    }

    if (toolName === 'ai.build_publish_pack') {
      const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), {
        taskType: 'publish_pack',
        input: { bookId: args.bookId },
      });
      appendRunStep(request.sessionId, toolName, '生成发布工作流包', 'completed');
      return result;
    }

    throw new Error(`尚未实现工具：${toolName}`);
  } catch (error) {
    appendRunStep(request.sessionId, toolName, `工具失败：${toolName}`, 'failed', error instanceof Error ? error.message : String(error));
    throw error;
  }
};
