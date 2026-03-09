import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AIReviewItem, Book, BookCheckpoint, FactEntry, HistoryAction, StoryNode } from '../src/types.ts';
import type { AgentRun, AgentToolScope, OperationJournalEntry } from '../shared/agent.ts';
import type { ContentSnapshot, SettingsSnapshot } from '../shared/storage.ts';
import { createEmptyContentSnapshot, createEmptySettingsSnapshot } from '../shared/storage.ts';

const DEFAULT_ALL_SCOPES: AgentToolScope[] = [
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

const now = () => Date.now();
const clone = <T>(value: T): T => structuredClone(value);
const createId = () => randomUUID();

export interface StoredAgentToken {
  id: string;
  name: string;
  scopes: AgentToolScope[];
  createdAt: number;
  lastUsedAt?: number;
}

export interface StoredAiTask {
  id: string;
  taskType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  bookId?: string;
  nodeId?: string;
  request: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), process.env.AGENT_DATA_DIR || 'data/local');
const DB_PATH = path.resolve(DATA_DIR, process.env.AGENT_DB_PATH || 'agent.sqlite');
const CONTENT_FILE_PATH = path.resolve(DATA_DIR, 'content.json');
const MODELS_FILE_PATH = path.resolve(DATA_DIR, 'models.json');
const BOOTSTRAP_TOKEN_FILE_PATH = path.resolve(DATA_DIR, 'agent-bootstrap-token.txt');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS operation_journal (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    entity_changes_json TEXT NOT NULL,
    checkpoint_id TEXT,
    is_ai INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    caller TEXT NOT NULL,
    status TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_tasks (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL,
    book_id TEXT,
    node_id TEXT,
    request_json TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS review_items (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    book_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    type TEXT NOT NULL,
    item_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS idempotency_records (
    idempotency_key TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const readJsonFile = <T>(filePath: string, fallback: T): T => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`Failed to read JSON file ${filePath}:`, error);
    return fallback;
  }
};

const writeJsonFile = (filePath: string, payload: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

const readState = <T>(key: string, fallback: T): T => {
  const row = db.prepare('SELECT value_json FROM app_state WHERE key = ?').get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch (error) {
    console.error(`Failed to parse app_state:${key}`, error);
    return fallback;
  }
};

const writeState = (key: string, value: unknown) => {
  db.prepare(`
    INSERT INTO app_state (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), now());
};

const normalizeContentSnapshot = (payload: Partial<ContentSnapshot> | null | undefined): ContentSnapshot => {
  const safe = payload || {};
  const base = createEmptyContentSnapshot();
  return {
    ...base,
    ...safe,
    version: Number(safe.version || base.version),
    books: Array.isArray(safe.books) ? safe.books : [],
    nodes: Array.isArray(safe.nodes) ? safe.nodes : [],
    history: Array.isArray(safe.history) ? safe.history : [],
    snapshots: Array.isArray(safe.snapshots) ? safe.snapshots : [],
    deletedBooks: Array.isArray(safe.deletedBooks) ? safe.deletedBooks : [],
    deletedNodes: Array.isArray(safe.deletedNodes) ? safe.deletedNodes : [],
    facts: Array.isArray(safe.facts) ? safe.facts : [],
    factCandidates: Array.isArray(safe.factCandidates) ? safe.factCandidates : [],
    foreshadows: Array.isArray(safe.foreshadows) ? safe.foreshadows : [],
    materials: Array.isArray(safe.materials) ? safe.materials : [],
    characterStates: Array.isArray(safe.characterStates) ? safe.characterStates : [],
    checkpoints: Array.isArray(safe.checkpoints) ? safe.checkpoints : [],
    references: Array.isArray(safe.references) ? safe.references : [],
  };
};

const normalizeSettingsSnapshot = (payload: Partial<SettingsSnapshot> | null | undefined): SettingsSnapshot => {
  const safe = payload || {};
  return {
    state: safe.state && typeof safe.state === 'object' ? safe.state as Record<string, unknown> : {},
    version: Number(safe.version || 0),
  };
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const createPlainToken = () => randomBytes(24).toString('hex');

const bootstrapToken = () => {
  const existing = db.prepare('SELECT COUNT(*) as count FROM agent_tokens').get() as { count: number };
  if (existing.count > 0) return;

  const token = process.env.AGENT_BOOTSTRAP_TOKEN?.trim() || readBootstrapTokenFile() || createPlainToken();
  createAgentTokenInternal('Bootstrap Admin', DEFAULT_ALL_SCOPES, token);
  if (!process.env.AGENT_BOOTSTRAP_TOKEN) {
    fs.writeFileSync(BOOTSTRAP_TOKEN_FILE_PATH, token);
  }
};

const readBootstrapTokenFile = () => {
  try {
    if (!fs.existsSync(BOOTSTRAP_TOKEN_FILE_PATH)) return '';
    return fs.readFileSync(BOOTSTRAP_TOKEN_FILE_PATH, 'utf8').trim();
  } catch {
    return '';
  }
};

const bootstrapState = () => {
  const contentExists = db.prepare('SELECT COUNT(*) as count FROM app_state WHERE key = ?').get('content') as { count: number };
  if (contentExists.count === 0) {
    writeState('content', normalizeContentSnapshot(readJsonFile(CONTENT_FILE_PATH, createEmptyContentSnapshot())));
  }

  const settingsExists = db.prepare('SELECT COUNT(*) as count FROM app_state WHERE key = ?').get('settings') as { count: number };
  if (settingsExists.count === 0) {
    writeState('settings', normalizeSettingsSnapshot(readJsonFile(MODELS_FILE_PATH, createEmptySettingsSnapshot())));
  }
};

bootstrapState();
bootstrapToken();

export const getContentSnapshot = () => normalizeContentSnapshot(readState('content', createEmptyContentSnapshot()));

export const saveContentSnapshot = (snapshot: ContentSnapshot) => {
  const normalized = normalizeContentSnapshot(snapshot);
  writeState('content', normalized);
  writeJsonFile(CONTENT_FILE_PATH, normalized);
  return normalized;
};

export const getSettingsSnapshot = () => normalizeSettingsSnapshot(readState('settings', createEmptySettingsSnapshot()));

export const saveSettingsSnapshot = (snapshot: SettingsSnapshot) => {
  const normalized = normalizeSettingsSnapshot(snapshot);
  writeState('settings', normalized);
  writeJsonFile(MODELS_FILE_PATH, normalized);
  return normalized;
};

export const withContentMutation = <T>(
  mutate: (snapshot: ContentSnapshot) => T
): { snapshot: ContentSnapshot; result: T } => {
  const next = clone(getContentSnapshot());
  const result = mutate(next);
  const saved = saveContentSnapshot(next);
  return { snapshot: saved, result };
};

export const findBook = (snapshot: ContentSnapshot, bookId: string) => snapshot.books.find((book) => book.id === bookId) || null;

export const findNode = (snapshot: ContentSnapshot, nodeId: string) => snapshot.nodes.find((node) => node.id === nodeId) || null;

export const getBookNodes = (snapshot: ContentSnapshot, bookId: string) => snapshot.nodes
  .filter((node) => node.bookId === bookId)
  .sort((a, b) => a.order - b.order);

export const getBookFacts = (snapshot: ContentSnapshot, bookId: string) => snapshot.facts.filter((fact) => fact.bookId === bookId);

export const getBookMaterials = (snapshot: ContentSnapshot, bookId: string) => snapshot.materials.filter((entry) => entry.bookId === bookId);

export const getBookForeshadows = (snapshot: ContentSnapshot, bookId: string) => snapshot.foreshadows.filter((entry) => entry.bookId === bookId);

export const getBookReferences = (snapshot: ContentSnapshot, bookId: string) => snapshot.references.filter((entry) => entry.bookId === bookId);

export const getBookCharacterStates = (snapshot: ContentSnapshot, bookId: string) => snapshot.characterStates.filter((entry) => entry.bookId === bookId);

export const calculateBookWordCount = (snapshot: ContentSnapshot, bookId: string) => snapshot.nodes
  .filter((node) => node.bookId === bookId)
  .reduce((total, node) => total + (node.content?.length || 0), 0);

export const refreshBookWordCount = (snapshot: ContentSnapshot, bookId: string) => {
  const book = findBook(snapshot, bookId);
  if (!book) return 0;
  const wordCount = calculateBookWordCount(snapshot, bookId);
  book.wordCount = wordCount;
  return wordCount;
};

export const saveHistoryEntry = (
  snapshot: ContentSnapshot,
  nodeId: string,
  content: string,
  action: HistoryAction = 'manual'
) => {
  const entries = snapshot.history
    .filter((entry) => entry.nodeId === nodeId)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (entries[0]?.content === content) return;

  snapshot.history.push({
    id: Date.now(),
    nodeId,
    content,
    timestamp: now(),
    action,
  });
};

export const createCheckpoint = (
  snapshot: ContentSnapshot,
  bookId: string,
  name: string
): BookCheckpoint => {
  const book = findBook(snapshot, bookId);
  if (!book) {
    throw new Error('书籍不存在');
  }

  const nodes = getBookNodes(snapshot, bookId).map((node) => clone(node));
  const facts = getBookFacts(snapshot, bookId).map((item) => clone(item));
  const foreshadows = getBookForeshadows(snapshot, bookId).map((item) => clone(item));
  const materials = getBookMaterials(snapshot, bookId).map((item) => clone(item));
  const characterStates = getBookCharacterStates(snapshot, bookId).map((item) => clone(item));
  const references = getBookReferences(snapshot, bookId).map((item) => clone(item));

  const checkpoint: BookCheckpoint = {
    id: createId(),
    bookId,
    name,
    createdAt: now(),
    wordCount: calculateBookWordCount(snapshot, bookId),
    nodeCount: nodes.length,
    payload: {
      book: clone(book),
      nodes,
      facts,
      foreshadows,
      materials,
      characterStates,
      references,
    },
  };

  snapshot.checkpoints.unshift(checkpoint);
  return checkpoint;
};

export const rollbackCheckpoint = (snapshot: ContentSnapshot, checkpointId: string) => {
  const checkpoint = snapshot.checkpoints.find((entry) => entry.id === checkpointId);
  if (!checkpoint) {
    throw new Error('版本点不存在');
  }

  const { payload, bookId } = checkpoint;
  snapshot.books = snapshot.books
    .filter((book) => book.id !== bookId)
    .concat(clone(payload.book));
  snapshot.nodes = snapshot.nodes.filter((node) => node.bookId !== bookId).concat(payload.nodes.map((node) => clone(node)));
  snapshot.facts = snapshot.facts.filter((fact) => fact.bookId !== bookId).concat(payload.facts.map((fact) => clone(fact)));
  snapshot.foreshadows = snapshot.foreshadows
    .filter((entry) => entry.bookId !== bookId)
    .concat(payload.foreshadows.map((entry) => clone(entry)));
  snapshot.materials = snapshot.materials
    .filter((entry) => entry.bookId !== bookId)
    .concat(payload.materials.map((entry) => clone(entry)));
  snapshot.characterStates = snapshot.characterStates
    .filter((entry) => entry.bookId !== bookId)
    .concat(payload.characterStates.map((entry) => clone(entry)));
  snapshot.references = snapshot.references
    .filter((entry) => entry.bookId !== bookId)
    .concat(payload.references.map((entry) => clone(entry)));
  refreshBookWordCount(snapshot, bookId);
  return checkpoint;
};

export const createAgentToken = (name: string, scopes: AgentToolScope[]) => {
  const plainToken = createPlainToken();
  const token = createAgentTokenInternal(name, scopes, plainToken);
  return {
    token: plainToken,
    record: token,
  };
};

function createAgentTokenInternal(name: string, scopes: AgentToolScope[], plainToken: string): StoredAgentToken {
  const tokenId = createId();
  const createdAt = now();
  db.prepare(`
    INSERT INTO agent_tokens (id, name, token_hash, scopes_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tokenId, name, hashToken(plainToken), JSON.stringify(scopes), createdAt);
  return { id: tokenId, name, scopes, createdAt };
}

export const getAgentTokenByPlainToken = (plainToken: string): StoredAgentToken | null => {
  const row = db.prepare(`
    SELECT id, name, scopes_json, created_at, last_used_at
    FROM agent_tokens
    WHERE token_hash = ?
  `).get(hashToken(plainToken)) as {
    id: string;
    name: string;
    scopes_json: string;
    created_at: number;
    last_used_at?: number | null;
  } | undefined;

  if (!row) return null;
  db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.id);
  return {
    id: row.id,
    name: row.name,
    scopes: JSON.parse(row.scopes_json) as AgentToolScope[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || undefined,
  };
};

export const listAgentTokens = () => {
  const rows = db.prepare(`
    SELECT id, name, scopes_json, created_at, last_used_at
    FROM agent_tokens
    ORDER BY created_at DESC
  `).all() as Array<{
    id: string;
    name: string;
    scopes_json: string;
    created_at: number;
    last_used_at?: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scopes: JSON.parse(row.scopes_json) as AgentToolScope[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || undefined,
  }));
};

export const saveIdempotentResponse = (toolName: string, idempotencyKey: string, response: unknown) => {
  db.prepare(`
    INSERT INTO idempotency_records (idempotency_key, tool_name, response_json, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      tool_name = excluded.tool_name,
      response_json = excluded.response_json
  `).run(idempotencyKey, toolName, JSON.stringify(response), now());
};

export const getIdempotentResponse = (idempotencyKey: string) => {
  const row = db.prepare(`
    SELECT tool_name, response_json
    FROM idempotency_records
    WHERE idempotency_key = ?
  `).get(idempotencyKey) as { tool_name: string; response_json: string } | undefined;
  if (!row) return null;
  return {
    toolName: row.tool_name,
    response: JSON.parse(row.response_json) as unknown,
  };
};

export const appendOperationJournal = (entry: OperationJournalEntry) => {
  db.prepare(`
    INSERT INTO operation_journal (id, actor_type, actor_id, tool_name, entity_changes_json, checkpoint_id, is_ai, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.actorType,
    entry.actorId,
    entry.toolName,
    JSON.stringify(entry.entityChanges),
    entry.checkpointId || null,
    entry.isAI ? 1 : 0,
    entry.createdAt
  );
};

export const listOperationJournal = (limit = 100) => {
  const rows = db.prepare(`
    SELECT id, actor_type, actor_id, tool_name, entity_changes_json, checkpoint_id, is_ai, created_at
    FROM operation_journal
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    actor_type: OperationJournalEntry['actorType'];
    actor_id: string;
    tool_name: string;
    entity_changes_json: string;
    checkpoint_id?: string | null;
    is_ai: number;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    toolName: row.tool_name,
    entityChanges: JSON.parse(row.entity_changes_json) as OperationJournalEntry['entityChanges'],
    checkpointId: row.checkpoint_id || undefined,
    isAI: Boolean(row.is_ai),
    createdAt: row.created_at,
  }));
};

export const saveAgentRun = (run: AgentRun) => {
  db.prepare(`
    INSERT INTO agent_runs (id, goal, caller, status, steps_json, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      goal = excluded.goal,
      caller = excluded.caller,
      status = excluded.status,
      steps_json = excluded.steps_json,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(run.id, run.goal, run.caller, run.status, JSON.stringify(run.steps), run.error || null, run.createdAt, run.updatedAt);
  return run;
};

export const getAgentRun = (runId: string): AgentRun | null => {
  const row = db.prepare(`
    SELECT id, goal, caller, status, steps_json, error, created_at, updated_at
    FROM agent_runs
    WHERE id = ?
  `).get(runId) as {
    id: string;
    goal: string;
    caller: AgentRun['caller'];
    status: AgentRun['status'];
    steps_json: string;
    error?: string | null;
    created_at: number;
    updated_at: number;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    goal: row.goal,
    caller: row.caller,
    status: row.status,
    steps: JSON.parse(row.steps_json) as AgentRun['steps'],
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listAgentRuns = (limit = 50) => {
  const rows = db.prepare(`
    SELECT id, goal, caller, status, steps_json, error, created_at, updated_at
    FROM agent_runs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    goal: string;
    caller: AgentRun['caller'];
    status: AgentRun['status'];
    steps_json: string;
    error?: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    goal: row.goal,
    caller: row.caller,
    status: row.status,
    steps: JSON.parse(row.steps_json) as AgentRun['steps'],
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const saveAiTask = (task: StoredAiTask) => {
  db.prepare(`
    INSERT INTO ai_tasks (id, task_type, status, book_id, node_id, request_json, result_json, error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      result_json = excluded.result_json,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    task.id,
    task.taskType,
    task.status,
    task.bookId || null,
    task.nodeId || null,
    JSON.stringify(task.request),
    task.result === undefined ? null : JSON.stringify(task.result),
    task.error || null,
    task.createdAt,
    task.updatedAt
  );
  return task;
};

export const getAiTask = (taskId: string): StoredAiTask | null => {
  const row = db.prepare(`
    SELECT id, task_type, status, book_id, node_id, request_json, result_json, error, created_at, updated_at
    FROM ai_tasks
    WHERE id = ?
  `).get(taskId) as {
    id: string;
    task_type: string;
    status: StoredAiTask['status'];
    book_id?: string | null;
    node_id?: string | null;
    request_json: string;
    result_json?: string | null;
    error?: string | null;
    created_at: number;
    updated_at: number;
  } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    taskType: row.task_type,
    status: row.status,
    bookId: row.book_id || undefined,
    nodeId: row.node_id || undefined,
    request: JSON.parse(row.request_json) as Record<string, unknown>,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const listAiTasks = (limit = 100) => {
  const rows = db.prepare(`
    SELECT id, task_type, status, book_id, node_id, request_json, result_json, error, created_at, updated_at
    FROM ai_tasks
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    task_type: string;
    status: StoredAiTask['status'];
    book_id?: string | null;
    node_id?: string | null;
    request_json: string;
    result_json?: string | null;
    error?: string | null;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    taskType: row.task_type,
    status: row.status,
    bookId: row.book_id || undefined,
    nodeId: row.node_id || undefined,
    request: JSON.parse(row.request_json) as Record<string, unknown>,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
};

export const saveReviewItem = (item: AIReviewItem) => {
  db.prepare(`
    INSERT INTO review_items (id, status, book_id, node_id, type, item_json, created_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      item_json = excluded.item_json,
      reviewed_at = excluded.reviewed_at
  `).run(
    item.id,
    item.status,
    item.bookId,
    item.nodeId,
    item.type,
    JSON.stringify(item),
    item.createdAt,
    item.reviewedAt || null
  );
  return item;
};

export const getReviewItem = (reviewId: string): AIReviewItem | null => {
  const row = db.prepare(`
    SELECT item_json
    FROM review_items
    WHERE id = ?
  `).get(reviewId) as { item_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.item_json) as AIReviewItem;
};

export const listReviewItems = (bookId?: string) => {
  const rows = (bookId
    ? db.prepare(`
        SELECT item_json
        FROM review_items
        WHERE book_id = ?
        ORDER BY created_at DESC
      `).all(bookId)
    : db.prepare(`
        SELECT item_json
        FROM review_items
        ORDER BY created_at DESC
      `).all()) as Array<{ item_json: string }>;

  return rows.map((row) => JSON.parse(row.item_json) as AIReviewItem);
};

export const updateReviewItemStatus = (reviewId: string, status: AIReviewItem['status']) => {
  const item = getReviewItem(reviewId);
  if (!item) return null;
  item.status = status;
  item.reviewedAt = now();
  saveReviewItem(item);
  return item;
};

export const createNode = (
  snapshot: ContentSnapshot,
  input: Pick<StoryNode, 'bookId' | 'parentId' | 'type' | 'title' | 'summary'> & Partial<Pick<StoryNode, 'meta' | 'content' | 'status' | 'order'>>
) => {
  const siblingOrders = snapshot.nodes
    .filter((node) => node.parentId === input.parentId)
    .map((node) => node.order);
  const order = input.order !== undefined ? input.order : (siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0);
  const node: StoryNode = {
    id: createId(),
    bookId: input.bookId,
    parentId: input.parentId,
    type: input.type,
    title: input.title,
    summary: input.summary,
    content: input.content,
    status: input.status || 'empty',
    order,
    meta: input.meta,
  };
  snapshot.nodes.push(node);
  return node;
};

export const createBook = (
  snapshot: ContentSnapshot,
  input: Pick<Book, 'title' | 'premise' | 'worldSetting' | 'characters'>
) => {
  const book: Book = {
    id: createId(),
    title: input.title,
    premise: input.premise,
    worldSetting: input.worldSetting,
    characters: input.characters,
    wordCount: 0,
    createdAt: now(),
  };
  snapshot.books.push(book);
  return book;
};

export const upsertFact = (snapshot: ContentSnapshot, fact: FactEntry) => {
  const existingIndex = snapshot.facts.findIndex((entry) => entry.id === fact.id);
  if (existingIndex >= 0) {
    snapshot.facts[existingIndex] = fact;
    return fact;
  }
  snapshot.facts.push(fact);
  return fact;
};
