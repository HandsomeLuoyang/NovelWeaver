import { v4 as uuidv4 } from 'uuid';
import { AIReviewItem, AITaskType } from '../types';
import { createAutoSnapshotForParent, db, saveHistory, updateBookWordCount } from '../db';

export const createReviewItemId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
);

export const buildReviewItem = (input: {
  taskId?: string;
  type: AITaskType;
  bookId: string;
  nodeId: string;
  nodeTitle: string;
  promptProfileId?: string;
  source: AIReviewItem['source'];
  payload: AIReviewItem['payload'];
}): AIReviewItem => ({
  id: createReviewItemId(),
  taskId: input.taskId || `direct-${Date.now()}`,
  type: input.type,
  bookId: input.bookId,
  nodeId: input.nodeId,
  nodeTitle: input.nodeTitle,
  createdAt: Date.now(),
  promptProfileId: input.promptProfileId,
  source: input.source,
  status: 'pending',
  payload: input.payload,
});

export const applyReviewItem = async (item: AIReviewItem) => {
  const payload = item.payload;
  if (payload.kind === 'expansion') {
    const existingChildrenCount = await db.nodes.where({ parentId: item.nodeId }).count();
    if (existingChildrenCount > 0) {
      await createAutoSnapshotForParent(item.nodeId, 'review-apply');
    }

    const newNodes = payload.nodes.map((child, index) => ({
      id: uuidv4(),
      bookId: item.bookId,
      parentId: item.nodeId,
      type: payload.childType,
      title: child.title,
      summary: child.summary,
      status: 'empty' as const,
      order: existingChildrenCount + index,
    }));

    if (newNodes.length > 0) {
      await db.nodes.bulkAdd(newNodes);
    }
    await db.nodes.update(item.nodeId, { status: 'outlined' });
    return;
  }

  const generatedContent = payload.generatedContent.trim();
  const status = generatedContent.length > 100 ? 'drafted' : 'outlined';
  await db.nodes.update(item.nodeId, {
    content: generatedContent,
    status,
  });
  await saveHistory(
    item.nodeId,
    generatedContent,
    payload.mode === 'draft' ? 'ai-draft' : 'ai-polish'
  );
  await updateBookWordCount(item.bookId);
};
