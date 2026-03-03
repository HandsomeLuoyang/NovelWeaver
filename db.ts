import Dexie, { Table } from 'dexie';
import { Book, StoryNode, HistoryEntry, StructureSnapshot, HistoryAction } from './types';

class NovelWeaverDatabase extends Dexie {
  books!: Table<Book>;
  nodes!: Table<StoryNode>;
  history!: Table<HistoryEntry, number>;
  snapshots!: Table<StructureSnapshot>;

  constructor() {
    super('NovelWeaverDB');
    this.version(6).stores({
      books: 'id, title, createdAt',
      nodes: 'id, bookId, parentId, type, order, [bookId+parentId]',
      history: '++id, nodeId, timestamp, action',
      snapshots: 'id, parentId, bookId, createdAt'
    });
  }
}


export const db = new NovelWeaverDatabase();

// Helper to delete a node and all its descendants recursively
export const deleteNodeRecursive = async (nodeId: string) => {
  const children = await db.nodes.where('parentId').equals(nodeId).toArray();
  for (const child of children) {
    await deleteNodeRecursive(child.id);
  }
  await db.nodes.delete(nodeId);
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
