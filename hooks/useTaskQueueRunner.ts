import { useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { db, getAncestors, getLinearContext, getSemanticContext, saveHistory, updateBookWordCount } from '../db';
import { expandNode, draftScene, polishText } from '../services/geminiService';
import { AITask, NodeType } from '../types';

const getChildType = (type: NodeType): NodeType | null => {
  switch (type) {
    case 'volume':
      return 'arc';
    case 'arc':
      return 'chapter';
    case 'chapter':
      return 'scene';
    default:
      return null;
  }
};

const executeTask = async (task: AITask) => {
  const book = await db.books.get(task.bookId);
  if (!book) throw new Error('书籍不存在或已删除');

  const node = await db.nodes.get(task.nodeId);
  if (!node) throw new Error('节点不存在或已删除');

  if (task.type === 'expansion') {
    const childType = getChildType(node.type);
    if (!childType) throw new Error('当前节点不支持扩写');

    const result = await expandNode(node, book, childType);
    const existingChildrenCount = await db.nodes.where({ parentId: node.id }).count();
    const newNodes = result.nodes.map((n, idx) => ({
      id: uuidv4(),
      bookId: book.id,
      parentId: node.id,
      type: childType,
      title: n.title,
      summary: n.summary,
      status: 'empty' as const,
      order: existingChildrenCount + idx,
    }));

    if (newNodes.length > 0) {
      await db.nodes.bulkAdd(newNodes);
    }
    await db.nodes.update(node.id, { status: 'outlined' });
    return;
  }

  if (task.type === 'draft') {
    if (node.type !== 'scene') throw new Error('仅场景节点支持草稿');

    const linearContext = await getLinearContext(book.id, node.id, 5);
    const ancestors = await getAncestors(node.id);
    const semanticContext = await getSemanticContext(book.id, node.id, `${node.title}\n${node.summary}`, 3);

    let fullDraft = '';
    await draftScene(node, book, ancestors, linearContext, semanticContext, (chunk) => {
      fullDraft += chunk;
    });

    await db.nodes.update(node.id, { content: fullDraft, status: 'drafted' });
    await saveHistory(node.id, fullDraft, 'ai-draft');
    await updateBookWordCount(book.id);
    return;
  }

  const original = (node.content || '').trim();
  if (!original) throw new Error('当前节点正文为空，无法润色');

  const context = `${node.summary}\n\n${original.slice(0, 800)}`;
  let polished = '';
  await polishText(original, context, book, (chunk) => {
    polished += chunk;
  });

  const finalContent = polished.trim() || original;
  await db.nodes.update(node.id, { content: finalContent, status: 'drafted' });
  await saveHistory(node.id, finalContent, 'ai-polish');
  await updateBookWordCount(book.id);
};

export const useTaskQueueRunner = () => {
  const {
    taskQueue,
    isTaskQueuePaused,
    isTaskQueueRunning,
    taskQueueConcurrency,
    isGenerating,
    setGenerating,
    setGenerationStatus,
    setTaskQueueRunning,
    updateTaskStatus,
  } = useStore();

  const runningTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isTaskQueuePaused) return;

    const runningTaskIds = runningTaskIdsRef.current;
    const externalGenerationRunning = isGenerating && runningTaskIds.size === 0;
    if (externalGenerationRunning) return;

    const pendingTasks = taskQueue.filter(
      (task) => task.status === 'pending' && !runningTaskIds.has(task.id)
    );
    const availableSlots = Math.max(0, taskQueueConcurrency - runningTaskIds.size);

    if (pendingTasks.length === 0 || availableSlots === 0) {
      if (runningTaskIds.size === 0 && isTaskQueueRunning) {
        setTaskQueueRunning(false);
        setGenerating(false);
        setGenerationStatus('');
      }
      return;
    }

    const tasksToStart = pendingTasks.slice(0, availableSlots);
    tasksToStart.forEach((task) => {
      runningTaskIds.add(task.id);
      setTaskQueueRunning(true);
      setGenerating(true);
      updateTaskStatus(task.id, 'running');
      setGenerationStatus(`任务队列执行中：${runningTaskIds.size}/${taskQueueConcurrency}`);

      const run = async () => {
        try {
          await executeTask(task);
          updateTaskStatus(task.id, 'completed');
        } catch (error: any) {
          const message = error?.message || '任务执行失败';
          updateTaskStatus(task.id, 'failed', message);
        } finally {
          runningTaskIds.delete(task.id);
          if (runningTaskIds.size === 0) {
            setTaskQueueRunning(false);
            setGenerating(false);
            setGenerationStatus('');
          } else {
            setGenerationStatus(`任务队列执行中：${runningTaskIds.size}/${taskQueueConcurrency}`);
          }
        }
      };

      void run();
    });
  }, [
    isGenerating,
    isTaskQueuePaused,
    isTaskQueueRunning,
    taskQueueConcurrency,
    setGenerating,
    setGenerationStatus,
    setTaskQueueRunning,
    taskQueue,
    updateTaskStatus,
  ]);
};
