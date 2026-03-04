import Dexie, { Table } from 'dexie';
import {
  Book,
  StoryNode,
  HistoryEntry,
  StructureSnapshot,
  HistoryAction,
  DeletedBookEntry,
  DeletedNodeEntry,
  RecoverySnapshot
} from './types';

class NovelWeaverDatabase extends Dexie {
  books!: Table<Book>;
  nodes!: Table<StoryNode>;
  history!: Table<HistoryEntry, number>;
  snapshots!: Table<StructureSnapshot>;
  deletedBooks!: Table<DeletedBookEntry>;
  deletedNodes!: Table<DeletedNodeEntry>;
  backups!: Table<RecoverySnapshot>;

  constructor() {
    super('NovelWeaverDB');
    this.version(6).stores({
      books: 'id, title, createdAt',
      nodes: 'id, bookId, parentId, type, order, [bookId+parentId]',
      history: '++id, nodeId, timestamp, action',
      snapshots: 'id, parentId, bookId, createdAt'
    });
    this.version(7).stores({
      books: 'id, title, createdAt',
      nodes: 'id, bookId, parentId, type, order, [bookId+parentId]',
      history: '++id, nodeId, timestamp, action',
      snapshots: 'id, parentId, bookId, createdAt',
      deletedBooks: 'id, deletedAt, title',
      deletedNodes: 'id, bookId, rootNodeId, deletedAt'
    });
    this.version(8).stores({
      books: 'id, title, createdAt',
      nodes: 'id, bookId, parentId, type, order, [bookId+parentId]',
      history: '++id, nodeId, timestamp, action',
      snapshots: 'id, parentId, bookId, createdAt',
      deletedBooks: 'id, deletedAt, title',
      deletedNodes: 'id, bookId, rootNodeId, deletedAt',
      backups: 'id, createdAt, source'
    });
  }
}


export const db = new NovelWeaverDatabase();

const collectSubtreeNodeIds = async (nodeId: string): Promise<string[]> => {
  const rootNode = await db.nodes.get(nodeId);
  if (!rootNode) return [];

  const allBookNodes = await db.nodes.where('bookId').equals(rootNode.bookId).toArray();
  const childrenByParent = new Map<string, StoryNode[]>();

  allBookNodes.forEach((node) => {
    if (!node.parentId) return;
    const bucket = childrenByParent.get(node.parentId) || [];
    bucket.push(node);
    childrenByParent.set(node.parentId, bucket);
  });

  const result: string[] = [];
  const stack: string[] = [nodeId];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    result.push(currentId);
    const children = childrenByParent.get(currentId) || [];
    children.forEach((child) => stack.push(child.id));
  }

  return result;
};

// Hard delete node subtree and related history/snapshots.
export const deleteNodeRecursive = async (nodeId: string) => {
  const nodeIds = await collectSubtreeNodeIds(nodeId);
  if (nodeIds.length === 0) return;

  await db.transaction('rw', db.nodes, db.history, db.snapshots, async () => {
    await db.history.where('nodeId').anyOf(nodeIds).delete();

    const snapshots = await db.snapshots.toArray();
    const snapshotIdsToDelete = snapshots
      .filter((snap) => nodeIds.includes(snap.parentId))
      .map((snap) => snap.id);
    if (snapshotIdsToDelete.length > 0) {
      await db.snapshots.bulkDelete(snapshotIdsToDelete);
    }

    await db.nodes.bulkDelete(nodeIds);
  });
};

// Helper to get full tree for a book (be careful with large books, prefer lazy load in UI)
export const getBookNodes = async (bookId: string) => {
  return await db.nodes.where('bookId').equals(bookId).sortBy('order');
};

// Helper to get all ancestors of a node (from Root down to immediate Parent)
export const getAncestors = async (nodeId: string): Promise<StoryNode[]> => {
  const ancestors: StoryNode[] = [];
  let current = await db.nodes.get(nodeId);

  if (!current) return [];

  // Traverse up
  let parentId = current.parentId;
  while (parentId) {
    const parent = await db.nodes.get(parentId);
    if (parent) {
      ancestors.unshift(parent); // Add to beginning to maintain Top-down order (Volume -> Arc -> Chapter)
      parentId = parent.parentId;
    } else {
      break;
    }
  }
  return ancestors;
};

/**
 * Traverses the tree depth-first to find the linear order of scenes,
 * then returns the content of the N scenes preceding the current one.
 */
export const getLinearContext = async (bookId: string, currentNodeId: string, limit: number = 3): Promise<string> => {
  const allNodes = await db.nodes.where({ bookId }).toArray();

  // Sort logic helper
  const sortNodes = (nodes: StoryNode[]) => nodes.sort((a, b) => a.order - b.order);

  // Recursive flattener
  const buildLinearList = (parentId: string | null): StoryNode[] => {
    const children = sortNodes(allNodes.filter(n => n.parentId === parentId));
    return children.flatMap(node => {
      // If it's a scene (leaf), return it. If it's a container, traverse deeper.
      // Note: Some users might write content in 'chapter' nodes too, but we focus on 'scene' for now based on specs.
      if (node.type === 'scene') return [node];
      return buildLinearList(node.id);
    });
  };

  const linearScenes = buildLinearList(null);
  const currentIndex = linearScenes.findIndex(n => n.id === currentNodeId);

  if (currentIndex <= 0) return "";

  const prevScenes = linearScenes.slice(Math.max(0, currentIndex - limit), currentIndex);
  return prevScenes.map(n => `[前文场景: ${n.title}]\n${n.content || '(暂无内容)'}`).join('\n\n');
};

const extractKeywords = (text: string) => {
  const lowered = text.toLowerCase();
  const matches = lowered.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) || [];
  return Array.from(new Set(matches)).slice(0, 40);
};

const toTermFrequency = (tokens: string[]) => {
  const tf = new Map<string, number>();
  tokens.forEach((token) => {
    tf.set(token, (tf.get(token) || 0) + 1);
  });
  return tf;
};

const cosineSimilarity = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  a.forEach((value, key) => {
    normA += value * value;
    const other = b.get(key) || 0;
    dot += value * other;
  });
  b.forEach((value) => {
    normB += value * value;
  });

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const buildIdf = (documents: string[][]) => {
  const docCount = documents.length;
  const df = new Map<string, number>();
  documents.forEach((doc) => {
    const seen = new Set(doc);
    seen.forEach((token) => {
      df.set(token, (df.get(token) || 0) + 1);
    });
  });

  const idf = new Map<string, number>();
  df.forEach((count, token) => {
    idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  });
  return idf;
};

const applyIdf = (tf: Map<string, number>, idf: Map<string, number>) => {
  const weighted = new Map<string, number>();
  tf.forEach((value, token) => {
    weighted.set(token, value * (idf.get(token) || 1));
  });
  return weighted;
};

export const getSemanticContext = async (
  bookId: string,
  currentNodeId: string,
  query: string,
  limit: number = 3
): Promise<string> => {
  const queryTokens = extractKeywords(query);
  if (queryTokens.length === 0) return "";
  const candidateScenes = (await db.nodes.where({ bookId }).toArray())
    .filter((node) => node.type === 'scene' && node.id !== currentNodeId && Boolean(node.content?.trim()));
  const docs = candidateScenes.map((scene) => extractKeywords(`${scene.title}\n${scene.summary}\n${scene.content || ''}`));
  docs.push(queryTokens);
  const idf = buildIdf(docs);
  const queryVector = applyIdf(toTermFrequency(queryTokens), idf);

  const scored = candidateScenes
    .map((scene, index) => {
      const sceneVector = applyIdf(toTermFrequency(docs[index]), idf);
      const score = cosineSimilarity(queryVector, sceneVector);
      return { scene, score };
    })
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return "";

  return scored
    .map((item) => `[相关场景: ${item.scene.title} | 相关度:${item.score.toFixed(2)}]\n${item.scene.content || ''}`)
    .join('\n\n');
};

// Helper to save content history
export const saveHistory = async (nodeId: string, content: string, action: HistoryAction = 'manual') => {
  // Only save if content is different from the last version
  const last = await db.history.where('nodeId').equals(nodeId).reverse().sortBy('timestamp');
  if (last.length > 0 && last[0].content === content) return;

  await db.history.add({
    nodeId,
    content,
    timestamp: Date.now(),
    action
  });

  // Keep only last 50 versions per node
  const count = await db.history.where('nodeId').equals(nodeId).count();
  if (count > 50) {
    const all = await db.history.where('nodeId').equals(nodeId).sortBy('timestamp');
    const toDelete = all.slice(0, count - 50);
    await db.history.bulkDelete(toDelete.map(x => x.id as number));
  }
};

export const getHistory = async (nodeId: string) => {
  return await db.history.where('nodeId').equals(nodeId).sortBy('timestamp');
};

// Helper to update book word count
export const updateBookWordCount = async (bookId: string) => {
  const allNodes = await db.nodes.where({ bookId }).toArray();
  // Filter for scene nodes only to be precise, or all nodes if summary counts?
  // Usually word count implies content length.
  const totalWords = allNodes.reduce((acc, node) => {
    return acc + (node.content ? node.content.length : 0);
  }, 0);

  await db.books.update(bookId, { wordCount: totalWords });
  return totalWords;
};

export const createAutoSnapshotForParent = async (parentId: string, reason: string = 'auto') => {
  const parent = await db.nodes.get(parentId);
  if (!parent) return null;

  const children = await db.nodes.where('parentId').equals(parentId).sortBy('order');
  if (children.length === 0) return null;

  const recentSnapshots = await db.snapshots.where('parentId').equals(parentId).reverse().sortBy('createdAt');
  const fingerprint = (nodes: StoryNode[]) =>
    JSON.stringify(nodes.map((node) => ({ title: node.title, summary: node.summary, order: node.order })));

  const currentFingerprint = fingerprint(children);
  const latestFingerprint = recentSnapshots.length > 0 ? fingerprint(recentSnapshots[0].nodes) : null;
  if (latestFingerprint && latestFingerprint === currentFingerprint) {
    return null;
  }

  const snapshot: StructureSnapshot = {
    id: crypto.randomUUID(),
    parentId,
    bookId: parent.bookId,
    createdAt: Date.now(),
    source: 'auto-backup',
    name: `Auto(${reason}) ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    nodes: children
  };

  await db.snapshots.add(snapshot);
  return snapshot.id;
};

const remapSnapshotNodes = (
  nodes: StoryNode[],
  nodeIdMap: Map<string, string>,
  bookId: string
) => {
  return nodes.map((node) => ({
    ...node,
    id: nodeIdMap.get(node.id) || node.id,
    bookId,
    parentId: node.parentId ? (nodeIdMap.get(node.parentId) || node.parentId) : null
  }));
};

export const getDeletedBooks = async () => {
  return db.deletedBooks.orderBy('deletedAt').reverse().toArray();
};

export const permanentlyDeleteBookFromRecycleBin = async (entryId: string) => {
  await db.deletedBooks.delete(entryId);
};

export const moveBookToRecycleBin = async (bookId: string) => {
  const book = await db.books.get(bookId);
  if (!book) throw new Error('书籍不存在');

  const nodes = await db.nodes.where('bookId').equals(bookId).toArray();
  const nodeIds = nodes.map((node) => node.id);
  const history = nodeIds.length > 0
    ? await db.history.where('nodeId').anyOf(nodeIds).toArray()
    : [];
  const snapshots = await db.snapshots.where('bookId').equals(bookId).toArray();

  const recycleEntry: DeletedBookEntry = {
    id: crypto.randomUUID(),
    deletedAt: Date.now(),
    title: book.title,
    data: {
      book,
      nodes,
      history,
      snapshots
    }
  };

  await db.transaction('rw', [db.books, db.nodes, db.history, db.snapshots, db.deletedBooks], async () => {
    await db.deletedBooks.add(recycleEntry);
    if (nodeIds.length > 0) {
      await db.history.where('nodeId').anyOf(nodeIds).delete();
    }
    await db.snapshots.where('bookId').equals(bookId).delete();
    await db.nodes.where('bookId').equals(bookId).delete();
    await db.books.delete(bookId);
  });

  return recycleEntry.id;
};

export const restoreBookFromRecycleBin = async (entryId: string) => {
  const recycleEntry = await db.deletedBooks.get(entryId);
  if (!recycleEntry) throw new Error('回收站记录不存在');

  const sourceBook = recycleEntry.data.book;
  const existingBook = await db.books.get(sourceBook.id);
  const restoredBookId = existingBook ? crypto.randomUUID() : sourceBook.id;
  const sourceNodeIds = recycleEntry.data.nodes.map((node) => node.id);
  const existingNodes = sourceNodeIds.length > 0 ? await db.nodes.bulkGet(sourceNodeIds) : [];
  const hasNodeIdCollision = existingNodes.some(Boolean);

  const nodeIdMap = new Map<string, string>();
  sourceNodeIds.forEach((sourceNodeId) => {
    nodeIdMap.set(sourceNodeId, hasNodeIdCollision ? crypto.randomUUID() : sourceNodeId);
  });

  const restoredBook: Book = {
    ...sourceBook,
    id: restoredBookId
  };

  const restoredNodes = recycleEntry.data.nodes.map((node) => ({
    ...node,
    id: nodeIdMap.get(node.id) || node.id,
    bookId: restoredBookId,
    parentId: node.parentId ? (nodeIdMap.get(node.parentId) || node.parentId) : null
  }));
  const restoredNodeIds = new Set(restoredNodes.map((node) => node.id));

  const restoredHistory = recycleEntry.data.history.map((entry) => ({
    ...entry,
    id: undefined,
    nodeId: nodeIdMap.get(entry.nodeId) || entry.nodeId
  }));

  const restoredSnapshots = recycleEntry.data.snapshots
    .map((snapshot) => ({
      ...snapshot,
      id: crypto.randomUUID(),
      bookId: restoredBookId,
      parentId: nodeIdMap.get(snapshot.parentId) || snapshot.parentId,
      nodes: remapSnapshotNodes(snapshot.nodes, nodeIdMap, restoredBookId)
    }))
    .filter((snapshot) => restoredNodeIds.has(snapshot.parentId));

  await db.transaction('rw', [db.books, db.nodes, db.history, db.snapshots, db.deletedBooks], async () => {
    await db.books.put(restoredBook);
    if (restoredNodes.length > 0) {
      await db.nodes.bulkPut(restoredNodes);
    }
    if (restoredHistory.length > 0) {
      await db.history.bulkAdd(restoredHistory);
    }
    if (restoredSnapshots.length > 0) {
      await db.snapshots.bulkPut(restoredSnapshots);
    }
    await db.deletedBooks.delete(entryId);
  });

  await updateBookWordCount(restoredBookId);
  return restoredBook;
};

export const getDeletedNodesForBook = async (bookId: string) => {
  const entries = await db.deletedNodes.where('bookId').equals(bookId).sortBy('deletedAt');
  return entries.reverse();
};

export const permanentlyDeleteNodeFromRecycleBin = async (entryId: string) => {
  await db.deletedNodes.delete(entryId);
};

export const moveNodeToRecycleBin = async (nodeId: string) => {
  const rootNode = await db.nodes.get(nodeId);
  if (!rootNode) throw new Error('节点不存在');
  if (rootNode.parentId) {
    await createAutoSnapshotForParent(rootNode.parentId, 'delete-node');
  }

  const nodeIds = await collectSubtreeNodeIds(nodeId);
  const nodeList = await db.nodes.bulkGet(nodeIds);
  const nodes = nodeList.filter((node): node is StoryNode => Boolean(node));

  const history = nodeIds.length > 0
    ? await db.history.where('nodeId').anyOf(nodeIds).toArray()
    : [];

  const snapshots = await db.snapshots.toArray();
  const relatedSnapshots = snapshots.filter((snapshot) => nodeIds.includes(snapshot.parentId));
  const relatedSnapshotIds = relatedSnapshots.map((snapshot) => snapshot.id);

  const recycleEntry: DeletedNodeEntry = {
    id: crypto.randomUUID(),
    bookId: rootNode.bookId,
    rootNodeId: rootNode.id,
    rootNodeTitle: rootNode.title,
    rootParentId: rootNode.parentId,
    deletedAt: Date.now(),
    data: {
      nodes,
      history,
      snapshots: relatedSnapshots
    }
  };

  await db.transaction('rw', [db.nodes, db.history, db.snapshots, db.deletedNodes], async () => {
    await db.deletedNodes.add(recycleEntry);
    if (nodeIds.length > 0) {
      await db.history.where('nodeId').anyOf(nodeIds).delete();
      await db.nodes.bulkDelete(nodeIds);
    }
    if (relatedSnapshotIds.length > 0) {
      await db.snapshots.bulkDelete(relatedSnapshotIds);
    }
  });

  await updateBookWordCount(rootNode.bookId);
  return recycleEntry.id;
};

export const restoreNodeFromRecycleBin = async (entryId: string) => {
  const recycleEntry = await db.deletedNodes.get(entryId);
  if (!recycleEntry) throw new Error('回收站记录不存在');

  const existingBook = await db.books.get(recycleEntry.bookId);
  if (!existingBook) throw new Error('所属书籍不存在，无法恢复节点');

  const sourceNodeIds = recycleEntry.data.nodes.map((node) => node.id);
  const existingNodes = sourceNodeIds.length > 0 ? await db.nodes.bulkGet(sourceNodeIds) : [];
  const hasNodeIdCollision = existingNodes.some(Boolean);

  const nodeIdMap = new Map<string, string>();
  sourceNodeIds.forEach((sourceNodeId) => {
    nodeIdMap.set(sourceNodeId, hasNodeIdCollision ? crypto.randomUUID() : sourceNodeId);
  });

  const existingParent = recycleEntry.rootParentId
    ? await db.nodes.get(recycleEntry.rootParentId)
    : null;
  const restoredRootParentId = recycleEntry.rootParentId && !existingParent
    ? null
    : recycleEntry.rootParentId;

  const restoredRootNodeId = nodeIdMap.get(recycleEntry.rootNodeId) || recycleEntry.rootNodeId;

  const restoredNodes = recycleEntry.data.nodes.map((node) => {
    const mappedNodeId = nodeIdMap.get(node.id) || node.id;
    const mappedParentId = node.parentId ? (nodeIdMap.get(node.parentId) || node.parentId) : null;

    return {
      ...node,
      id: mappedNodeId,
      bookId: recycleEntry.bookId,
      parentId: node.id === recycleEntry.rootNodeId ? restoredRootParentId : mappedParentId
    };
  });
  const restoredNodeIds = new Set(restoredNodes.map((node) => node.id));

  const restoredHistory = recycleEntry.data.history.map((entry) => ({
    ...entry,
    id: undefined,
    nodeId: nodeIdMap.get(entry.nodeId) || entry.nodeId
  }));

  const restoredSnapshots = recycleEntry.data.snapshots
    .map((snapshot) => ({
      ...snapshot,
      id: crypto.randomUUID(),
      bookId: recycleEntry.bookId,
      parentId: nodeIdMap.get(snapshot.parentId) || snapshot.parentId,
      nodes: remapSnapshotNodes(snapshot.nodes, nodeIdMap, recycleEntry.bookId)
    }))
    .filter((snapshot) => restoredNodeIds.has(snapshot.parentId));

  await db.transaction('rw', [db.nodes, db.history, db.snapshots, db.deletedNodes], async () => {
    if (restoredNodes.length > 0) {
      await db.nodes.bulkPut(restoredNodes);
    }
    if (restoredHistory.length > 0) {
      await db.history.bulkAdd(restoredHistory);
    }
    if (restoredSnapshots.length > 0) {
      await db.snapshots.bulkPut(restoredSnapshots);
    }
    await db.deletedNodes.delete(entryId);
  });

  await updateBookWordCount(recycleEntry.bookId);
  return restoredRootNodeId;
};

/**
 * Applies a structure snapshot:
 * 1. Backs up current children as "auto-backup"
 * 2. Deletes current children
 * 3. Restores nodes from snapshot
 */
export const applyStructureSnapshot = async (parentId: string, snapshotId: string) => {
  await db.transaction('rw', db.nodes, db.snapshots, async () => {
    const snapshot = await db.snapshots.get(snapshotId);
    if (!snapshot) throw new Error('Snapshot not found');

    // 1. Get current children
    const currentChildren = await db.nodes.where('parentId').equals(parentId).sortBy('order');

    // 2. Create backup if there are existing children
    if (currentChildren.length > 0) {
      // Check if the current state is already saved as the most recent snapshot to avoid duplicates
      const lastSnapshot = await db.snapshots.where('parentId').equals(parentId).reverse().sortBy('createdAt');

      // Helper to fingerprint nodes for comparison
      const fingerprint = (nodes: any[]) => JSON.stringify(nodes.map(n => ({t: n.title, s: n.summary})));

      const isDuplicate = lastSnapshot.length > 0 &&
        fingerprint(lastSnapshot[0].nodes) === fingerprint(currentChildren);

      if (!isDuplicate) {
        await db.snapshots.add({
          id: crypto.randomUUID(),
          parentId,
          bookId: snapshot.bookId,
          createdAt: Date.now(),
          source: 'auto-backup',
          name: `Backup ${new Date().toLocaleTimeString()}`,
          nodes: currentChildren
        });
      }
    }

    // 3. Delete current children and descendants to avoid orphan nodes
    const allBookNodes = await db.nodes.where('bookId').equals(snapshot.bookId).toArray();
    const descendantsByParent = new Map<string, StoryNode[]>();

    allBookNodes.forEach((n) => {
      if (!n.parentId) return;
      const arr = descendantsByParent.get(n.parentId) || [];
      arr.push(n);
      descendantsByParent.set(n.parentId, arr);
    });

    const toDelete = new Set<string>();
    const collectDescendants = (id: string) => {
      if (toDelete.has(id)) return;
      toDelete.add(id);
      const children = descendantsByParent.get(id) || [];
      children.forEach((child) => collectDescendants(child.id));
    };

    currentChildren.forEach((child) => collectDescendants(child.id));
    if (toDelete.size > 0) {
      await db.nodes.bulkDelete([...toDelete]);
    }

    // 4. Insert new nodes
    const newNodes = snapshot.nodes.map(n => ({
      ...n,
      parentId
    }));

    await db.nodes.bulkPut(newNodes);
  });
};
