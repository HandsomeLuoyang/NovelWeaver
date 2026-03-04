import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { db, getAncestors, getLinearContext, getSemanticContext } from '../db';
import { expandNode, draftScene, polishText } from '../services/geminiService';
import { extractPolishedSegment } from '../services/polishUtils';
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

const draftLengthHintByPreset = (preset: 'short' | 'medium' | 'long' | undefined) => {
  if (preset === 'short') return '短篇幅（约 600-900 字）';
  if (preset === 'long') return '长篇幅（约 1800-2600 字）';
  return '中篇幅（约 1000-1600 字）';
};

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

type ExecutedTaskResult =
  | {
      kind: 'expansion';
      childType: NodeType;
      nodes: Array<{ title: string; summary: string }>;
    }
  | {
      kind: 'text';
      mode: 'draft' | 'polish';
      originalContent: string;
      generatedContent: string;
    };

const executeTask = async (task: AITask): Promise<ExecutedTaskResult> => {
  const book = await db.books.get(task.bookId);
  if (!book) throw new Error('书籍不存在或已删除');

  const node = await db.nodes.get(task.nodeId);
  if (!node) throw new Error('节点不存在或已删除');

  if (task.type === 'expansion') {
    const childType = getChildType(node.type);
    if (!childType) throw new Error('当前节点不支持扩写');

    const result = await expandNode(
      node,
      book,
      childType,
      undefined,
      { promptProfileId: task.params?.promptProfileId }
    );

    return {
      kind: 'expansion',
      childType,
      nodes: result.nodes,
    };
  }

  if (task.type === 'draft') {
    if (node.type !== 'scene') throw new Error('仅场景节点支持草稿');

    const contextLimit = Math.min(10, Math.max(1, Number(task.params?.contextLimit || 5)));
    const linearContext = await getLinearContext(book.id, node.id, contextLimit);
    const ancestors = await getAncestors(node.id);
    const semanticContext = await getSemanticContext(book.id, node.id, `${node.title}\n${node.summary}`, 4);

    let fullDraft = '';
    await draftScene(
      node,
      book,
      ancestors,
      linearContext,
      semanticContext,
      (chunk) => {
        fullDraft += chunk;
      },
      undefined,
      {
        promptProfileId: task.params?.promptProfileId,
        draftLengthHint: draftLengthHintByPreset(task.params?.draftLength),
      }
    );

    return {
      kind: 'text',
      mode: 'draft',
      originalContent: node.content || '',
      generatedContent: fullDraft,
    };
  }

  const original = (node.content || '').trim();
  if (!original) throw new Error('当前节点正文为空，无法润色');

  const polishRange = task.params?.polishRange || 'scene';
  const rawSelectedText = task.params?.selectedText || '';
  const selectedText = polishRange === 'selection' && rawSelectedText.trim()
    ? rawSelectedText
    : original;

  const context = `${node.summary}\n\n${original.slice(0, 1000)}`;
  let rawPolished = '';
  await polishText(
    selectedText,
    context,
    book,
    (chunk) => {
      rawPolished += chunk;
    },
    undefined,
    {
      promptProfileId: task.params?.promptProfileId,
      polishRange,
    }
  );

  const polishedSegment = extractPolishedSegment(rawPolished).trim();
  if (!polishedSegment) {
    throw new Error('润色结果为空，请重试');
  }

  const generatedContent = polishRange === 'selection'
    ? (() => {
        const candidates = Array.from(new Set([selectedText, selectedText.trim()])).filter((item) => item.length > 0);
        for (const candidate of candidates) {
          const index = original.indexOf(candidate);
          if (index < 0) continue;
          return `${original.slice(0, index)}${polishedSegment}${original.slice(index + candidate.length)}`;
        }
        throw new Error('未在正文中定位到选区内容，请重新选中后再试');
      })()
    : polishedSegment;

  return {
    kind: 'text',
    mode: 'polish',
    originalContent: original,
    generatedContent,
  };
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
    addTaskResult,
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
          const result = await executeTask(task);
          addTaskResult({
            id: createId(),
            taskId: task.id,
            type: task.type,
            bookId: task.bookId,
            nodeId: task.nodeId,
            nodeTitle: task.nodeTitle,
            createdAt: Date.now(),
            promptProfileId: task.params?.promptProfileId,
            payload: result.kind === 'expansion'
              ? {
                  kind: 'expansion',
                  childType: result.childType,
                  nodes: result.nodes,
                }
              : {
                  kind: 'text',
                  mode: result.mode,
                  originalContent: result.originalContent,
                  generatedContent: result.generatedContent,
                },
          });
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
    addTaskResult,
  ]);
};
