import { db } from '../db';
import {
  Book,
  HistoryEntry,
  StoryNode,
  StructureSnapshot,
  DeletedBookEntry,
  DeletedNodeEntry,
  RecoverySnapshot,
  FactEntry,
  FactCandidate,
  ForeshadowEntry,
  MaterialEntry,
  SceneCharacterState,
  BookCheckpoint,
  ReferenceLink,
} from '../types';

interface ContentBackup {
  version: number;
  books: Book[];
  nodes: StoryNode[];
  history: HistoryEntry[];
  snapshots: StructureSnapshot[];
  deletedBooks: DeletedBookEntry[];
  deletedNodes: DeletedNodeEntry[];
  facts: FactEntry[];
  factCandidates: FactCandidate[];
  foreshadows: ForeshadowEntry[];
  materials: MaterialEntry[];
  characterStates: SceneCharacterState[];
  checkpoints: BookCheckpoint[];
  references: ReferenceLink[];
}

export interface IntegrityReport {
  ok: boolean;
  issues: string[];
}

export interface RecoverySnapshotMeta {
  id: string;
  createdAt: number;
  size: number;
  checksum: string;
  source: 'auto' | 'manual';
}

const API_Endpoint = '/api/storage/content';
const LOCAL_STORAGE_KEY = 'novelweaver-content-backup';
const RECOVERY_ROTATION_LIMIT = 30;
const AUTO_RECOVERY_INTERVAL = 5 * 60 * 1000;

let lastAutoRecoveryAt = 0;

const getBrowserStorage = () => {
  if (typeof window === 'undefined') return null;
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage) return null;
  return (
    typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function'
  ) ? storage as Storage : null;
};

const shouldUsePersistenceApi = () => typeof window !== 'undefined' && !Boolean(import.meta.env.VITEST);
const shouldLogPersistenceLifecycle = () => !Boolean(import.meta.env.VITEST);

const readLocalBackup = (): ContentBackup | null => {
  const storage = getBrowserStorage();
  if (!storage) return null;
  const raw = storage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ContentBackup;
  } catch (error) {
    console.error('Failed to parse local content backup:', error);
    return null;
  }
};

const checksum = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return `h${Math.abs(hash).toString(16)}`;
};

const serialize = (payload: ContentBackup) => JSON.stringify(payload);

const normalizeBackup = (payload: Partial<ContentBackup> | null | undefined): ContentBackup => {
  const safe = payload || {};
  return {
    version: Number(safe.version || 1),
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

const validateBackup = (payload: Partial<ContentBackup> | null | undefined): IntegrityReport => {
  const issues: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { ok: false, issues: ['备份文件为空或格式无效'] };
  }

  const normalized = normalizeBackup(payload);

  if (!Array.isArray(payload.books) || !Array.isArray(payload.nodes)) {
    issues.push('books/nodes 字段缺失');
  }

  const bookIds = new Set(normalized.books.map((book) => book.id));
  normalized.nodes.forEach((node) => {
    if (!bookIds.has(node.bookId)) {
      issues.push(`节点 ${node.title} 的 bookId 不存在`);
    }
  });
  normalized.facts.forEach((fact) => {
    if (!bookIds.has(fact.bookId)) {
      issues.push(`事实 ${fact.statement.slice(0, 20)}... 的 bookId 不存在`);
    }
  });
  normalized.factCandidates.forEach((candidate) => {
    if (!bookIds.has(candidate.bookId)) {
      issues.push(`候选事实 ${candidate.statement.slice(0, 20)}... 的 bookId 不存在`);
    }
  });
  normalized.foreshadows.forEach((entry) => {
    if (!bookIds.has(entry.bookId)) {
      issues.push(`伏笔 ${entry.title.slice(0, 20)}... 的 bookId 不存在`);
    }
  });
  normalized.materials.forEach((material) => {
    if (!bookIds.has(material.bookId)) {
      issues.push(`素材 ${material.title.slice(0, 20)}... 的 bookId 不存在`);
    }
  });
  normalized.characterStates.forEach((state) => {
    if (!bookIds.has(state.bookId)) {
      issues.push(`角色账本 ${state.characterName.slice(0, 20)}... 的 bookId 不存在`);
    }
  });
  normalized.references.forEach((reference) => {
    if (!bookIds.has(reference.bookId)) {
      issues.push(`引用链接 ${reference.entityType}/${reference.entityId} 的 bookId 不存在`);
    }
  });
  normalized.checkpoints.forEach((checkpoint) => {
    if (!bookIds.has(checkpoint.bookId)) {
      issues.push(`版本点 ${checkpoint.name.slice(0, 20)}... 的 bookId 不存在`);
    }
  });

  const nodeMap = new Map(normalized.nodes.map((node) => [node.id, node]));
  normalized.nodes.forEach((node) => {
    if (node.parentId && !nodeMap.has(node.parentId)) {
      issues.push(`节点 ${node.title} 的 parentId 无效`);
    }
  });

  const duplicateNodeIds = normalized.nodes
    .map((node) => node.id)
    .filter((id, idx, arr) => arr.indexOf(id) !== idx);
  if (duplicateNodeIds.length > 0) {
    issues.push(`存在重复节点 ID (${duplicateNodeIds.length})`);
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};

const collectBackupPayload = async (): Promise<ContentBackup> => {
  const books = await db.books.toArray();
  const nodes = await db.nodes.toArray();
  const history = await db.history.toArray();
  const snapshots = await db.snapshots.toArray();
  const deletedBooks = await db.deletedBooks.toArray();
  const deletedNodes = await db.deletedNodes.toArray();
  const facts = await db.facts.toArray();
  const factCandidates = await db.factCandidates.toArray();
  const foreshadows = await db.foreshadows.toArray();
  const materials = await db.materials.toArray();
  const characterStates = await db.characterStates.toArray();
  const checkpoints = await db.checkpoints.toArray();
  const references = await db.references.toArray();

  return {
    version: 1,
    books,
    nodes,
    history,
    snapshots,
    deletedBooks,
    deletedNodes,
    facts,
    factCandidates,
    foreshadows,
    materials,
    characterStates,
    checkpoints,
    references,
  };
};

const applyBackupPayload = async (payload: ContentBackup) => {
  await db.transaction('rw', [db.books, db.nodes, db.history, db.snapshots, db.deletedBooks, db.deletedNodes, db.facts, db.factCandidates, db.foreshadows, db.materials, db.characterStates, db.checkpoints, db.references], async () => {
    await db.books.clear();
    await db.nodes.clear();
    await db.history.clear();
    await db.snapshots.clear();
    await db.deletedBooks.clear();
    await db.deletedNodes.clear();
    await db.facts.clear();
    await db.factCandidates.clear();
    await db.foreshadows.clear();
    await db.materials.clear();
    await db.characterStates.clear();
    await db.checkpoints.clear();
    await db.references.clear();

    if (payload.books.length > 0) {
      await db.books.bulkAdd(payload.books);
    }
    if (payload.nodes.length > 0) {
      await db.nodes.bulkAdd(payload.nodes);
    }
    if (payload.history.length > 0) {
      await db.history.bulkAdd(payload.history);
    }
    if (payload.snapshots.length > 0) {
      await db.snapshots.bulkAdd(payload.snapshots);
    }
    if (payload.deletedBooks.length > 0) {
      await db.deletedBooks.bulkAdd(payload.deletedBooks);
    }
    if (payload.deletedNodes.length > 0) {
      await db.deletedNodes.bulkAdd(payload.deletedNodes);
    }
    if (payload.facts.length > 0) {
      await db.facts.bulkAdd(payload.facts);
    }
    if (payload.factCandidates.length > 0) {
      await db.factCandidates.bulkAdd(payload.factCandidates);
    }
    if (payload.foreshadows.length > 0) {
      await db.foreshadows.bulkAdd(payload.foreshadows);
    }
    if (payload.materials.length > 0) {
      await db.materials.bulkAdd(payload.materials);
    }
    if (payload.characterStates.length > 0) {
      await db.characterStates.bulkAdd(payload.characterStates);
    }
    if (payload.checkpoints.length > 0) {
      await db.checkpoints.bulkAdd(payload.checkpoints);
    }
    if (payload.references.length > 0) {
      await db.references.bulkAdd(payload.references);
    }
  });
};

const saveRecoverySnapshot = async (payload: ContentBackup, source: 'auto' | 'manual') => {
  const serialized = serialize(payload);
  const now = Date.now();

  const snapshot: RecoverySnapshot = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
    createdAt: now,
    size: serialized.length,
    checksum: checksum(serialized),
    source,
    payload: serialized,
  };

  await db.backups.add(snapshot);

  const backups = await db.backups.orderBy('createdAt').toArray();
  if (backups.length > RECOVERY_ROTATION_LIMIT) {
    const stale = backups.slice(0, backups.length - RECOVERY_ROTATION_LIMIT);
    await db.backups.bulkDelete(stale.map((item) => item.id));
  }
};

export const PersistenceService = {
  async loadFromDisk(force = false) {
    try {
      const bookCount = await db.books.count();
      if (!force && bookCount > 0) {
        if (shouldLogPersistenceLifecycle()) {
          console.log('DB not empty, skipping load from disk.');
        }
        return;
      }

      let data: Partial<ContentBackup> | null = null;

      if (shouldUsePersistenceApi()) {
        try {
          const res = await fetch(API_Endpoint);
          if (res.ok) {
            data = await res.json();
            const storage = getBrowserStorage();
            if (storage) {
              storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
            }
          }
        } catch (error) {
          console.error('Failed to load content from API, trying local backup.', error);
        }
      }

      if (!data) {
        data = readLocalBackup();
      }

      if (!data) return;

      const report = validateBackup(data);
      if (!report.ok) {
        console.error('Backup integrity check failed:', report.issues);
        throw new Error('备份完整性校验失败，请尝试恢复历史快照');
      }

      const normalized = normalizeBackup(data);
      await applyBackupPayload(normalized);
      await saveRecoverySnapshot(normalized, 'manual');
      if (shouldLogPersistenceLifecycle()) {
        console.log('Content loaded from disk successfully.');
      }
    } catch (err) {
      console.error('Persistence load error:', err);
    }
  },

  async saveToDisk() {
    try {
      const payload = await collectBackupPayload();

      const storage = getBrowserStorage();
      if (storage) {
        storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
      }

      if (shouldUsePersistenceApi()) {
        try {
          await fetch(API_Endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } catch (error) {
          console.error('Failed to save content via API, local backup kept.', error);
        }
      }

      if (Date.now() - lastAutoRecoveryAt > AUTO_RECOVERY_INTERVAL) {
        await saveRecoverySnapshot(payload, 'auto');
        lastAutoRecoveryAt = Date.now();
      }

      if (shouldLogPersistenceLifecycle()) {
        console.log('Content saved to disk.');
      }
    } catch (err) {
      console.error('Persistence save error:', err);
    }
  },

  async createManualRecoverySnapshot() {
    const payload = await collectBackupPayload();
    await saveRecoverySnapshot(payload, 'manual');
  },

  async listRecoverySnapshots(): Promise<RecoverySnapshotMeta[]> {
    const backups = await db.backups.orderBy('createdAt').reverse().toArray();
    return backups.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      size: item.size,
      checksum: item.checksum,
      source: item.source,
    }));
  },

  async restoreRecoverySnapshot(snapshotId: string): Promise<IntegrityReport> {
    const snapshot = await db.backups.get(snapshotId);
    if (!snapshot) {
      return { ok: false, issues: ['快照不存在'] };
    }

    try {
      const payload = JSON.parse(snapshot.payload) as Partial<ContentBackup>;
      const report = validateBackup(payload);
      if (!report.ok) return report;

      const normalized = normalizeBackup(payload);
      await applyBackupPayload(normalized);
      const storage = getBrowserStorage();
      if (storage) {
        storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
      }
      return { ok: true, issues: [] };
    } catch (error) {
      console.error(error);
      return { ok: false, issues: ['快照解析失败'] };
    }
  },

  async verifyCurrentDataIntegrity(): Promise<IntegrityReport> {
    const payload = await collectBackupPayload();
    return validateBackup(payload);
  },
};
