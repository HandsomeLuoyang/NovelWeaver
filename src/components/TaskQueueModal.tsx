import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { StoryNode } from '../types';
import { useToast } from '../hooks/useToast';
import { Icons } from './Icons';
import { useStore } from '../store';
import { DiffViewer } from './DiffViewer';
import { applyReviewItem } from '../services/reviewInbox';

interface TaskQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: StoryNode | null;
  selectedText?: string;
  initialTab?: 'queue' | 'results';
}

const statusMap = {
  pending: { label: '等待中', className: 'text-zinc-500 bg-zinc-500/10' },
  running: { label: '执行中', className: 'text-blue-500 bg-blue-500/10' },
  completed: { label: '已完成', className: 'text-emerald-500 bg-emerald-500/10' },
  failed: { label: '失败', className: 'text-red-500 bg-red-500/10' },
  cancelled: { label: '已取消', className: 'text-amber-500 bg-amber-500/10' },
} as const;

const draftLengthLabel = {
  short: '短',
  medium: '中',
  long: '长',
} as const;

export const TaskQueueModal: React.FC<TaskQueueModalProps> = ({ isOpen, onClose, node, selectedText, initialTab = 'queue' }) => {
  const {
    currentBook,
    taskQueue,
    reviewInbox,
    isTaskQueuePaused,
    isTaskQueueRunning,
    taskQueueConcurrency,
    promptProfiles,
    activePromptProfileId,
    enqueueTask,
    updateTaskStatus,
    removeTask,
    clearCompletedTasks,
    setTaskQueuePaused,
    setTaskQueueConcurrency,
    updateReviewItemStatus,
  } = useStore();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'queue' | 'results'>(initialTab);
  const [previewResultId, setPreviewResultId] = useState<string | null>(null);
  const [draftLength, setDraftLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [contextLimit, setContextLimit] = useState(5);
  const [polishRange, setPolishRange] = useState<'selection' | 'scene'>('scene');
  const [promptProfileId, setPromptProfileId] = useState(activePromptProfileId);

  useEffect(() => {
    if (!isOpen) return;
    setPromptProfileId(activePromptProfileId);
    setActiveTab(initialTab);
  }, [isOpen, activePromptProfileId, initialTab]);

  const currentBookResults = useMemo(
    () => reviewInbox.filter((result) => (!currentBook || result.bookId === currentBook.id) && result.status === 'pending'),
    [reviewInbox, currentBook]
  );

  if (!isOpen) return null;

  const canExpand = node && node.type !== 'scene';
  const canDraft = node && node.type === 'scene';
  const canPolish = node && node.type === 'scene' && Boolean(node.content?.trim());
  const hasSelectedText = Boolean(selectedText?.trim());

  const hasDuplicateTask = (type: 'expansion' | 'draft' | 'polish', nodeId: string) => {
    if (!currentBook) return false;
    const duplicate = taskQueue.some((task) =>
      task.bookId === currentBook.id
      && task.nodeId === nodeId
      && task.type === type
      && (task.status === 'pending' || task.status === 'running')
    );
    return duplicate;
  };

  const buildTaskParams = (type: 'expansion' | 'draft' | 'polish') => {
    const params: Record<string, any> = {
      promptProfileId,
    };

    if (type === 'draft') {
      params.draftLength = draftLength;
      params.contextLimit = contextLimit;
    }

    if (type === 'polish') {
      params.polishRange = polishRange;
      if (polishRange === 'selection') {
        params.selectedText = selectedText || '';
      }
    }

    return params;
  };

  const addTask = (type: 'expansion' | 'draft' | 'polish') => {
    if (!currentBook || !node) return;

    if (type === 'polish' && polishRange === 'selection' && !hasSelectedText) {
      toast.warning('当前未选中文本，无法添加“选区润色”任务');
      return;
    }

    if (hasDuplicateTask(type, node.id)) {
      toast.warning('队列中已存在相同任务');
      return;
    }

    enqueueTask({
      type,
      bookId: currentBook.id,
      nodeId: node.id,
      nodeTitle: node.title,
      params: buildTaskParams(type),
    });

    toast.success('任务已加入队列');
  };

  const addBatchExpansionForCurrentLevel = async () => {
    if (!currentBook || !node || node.type === 'scene') return;
    const sameLevelNodes = await db.nodes
      .where('bookId')
      .equals(currentBook.id)
      .filter((candidate) => candidate.type === node.type)
      .toArray();

    let added = 0;
    sameLevelNodes.forEach((candidate) => {
      if (hasDuplicateTask('expansion', candidate.id)) return;
      enqueueTask({
        type: 'expansion',
        bookId: currentBook.id,
        nodeId: candidate.id,
        nodeTitle: candidate.title,
        params: buildTaskParams('expansion'),
      });
      added += 1;
    });

    if (added === 0) {
      toast.info('同层扩写任务已全部在队列中');
    } else {
      toast.success(`已批量加入 ${added} 条扩写任务`);
    }
  };

  const addBatchSceneTasksForChapter = async (type: 'draft' | 'polish') => {
    if (!currentBook || !node || node.type !== 'scene' || !node.parentId) return;
    const siblings = await db.nodes
      .where('parentId')
      .equals(node.parentId)
      .toArray();

    let added = 0;
    siblings
      .filter((candidate) => candidate.type === 'scene')
      .forEach((candidate) => {
        if (type === 'polish' && !(candidate.content || '').trim()) return;
        if (hasDuplicateTask(type, candidate.id)) return;
        enqueueTask({
          type,
          bookId: currentBook.id,
          nodeId: candidate.id,
          nodeTitle: candidate.title,
          params: buildTaskParams(type),
        });
        added += 1;
      });

    if (added === 0) {
      toast.info(type === 'draft' ? '本章草稿任务已全部在队列中' : '本章润色任务已全部在队列中');
    } else {
      toast.success(`已批量加入 ${added} 条${type === 'draft' ? '草稿' : '润色'}任务`);
    }
  };

  const applyTaskResult = async (resultId: string) => {
    const result = reviewInbox.find((item) => item.id === resultId);
    if (!result) return;

    try {
      await applyReviewItem(result);
      updateReviewItemStatus(resultId, 'applied');
      toast.success('已应用任务结果');
    } catch (error) {
      console.error(error);
      toast.error('应用任务结果失败');
    }
  };

  const discardTaskResult = (resultId: string) => {
    updateReviewItemStatus(resultId, 'discarded');
    toast.info('已丢弃任务结果');
  };

  const renderTaskParams = (task: (typeof taskQueue)[number]) => {
    if (!task.params) return null;

    const parts: string[] = [];
    if (task.type === 'draft') {
      if (task.params.draftLength) parts.push(`字数档位:${draftLengthLabel[task.params.draftLength]}`);
      if (task.params.contextLimit) parts.push(`上下文:${task.params.contextLimit}`);
    }
    if (task.type === 'polish') {
      parts.push(task.params.polishRange === 'selection' ? '润色范围:选区' : '润色范围:整场景');
    }
    if (task.params.promptProfileId) {
      const profile = promptProfiles.find((item) => item.id === task.params?.promptProfileId);
      if (profile) parts.push(`提示词:${profile.name}`);
    }

    if (parts.length === 0) return null;
    return <div className="text-[11px] text-muted-foreground mt-1">{parts.join(' · ')}</div>;
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[86vh] border border-border bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col ui-rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Layers size={18} className="text-primary" />
              AI 任务队列与结果收件箱
            </h3>
            <p className="text-xs text-muted-foreground mt-1">支持参数化任务投递、结果预览、应用/丢弃</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="border-b border-border bg-background/40 px-4 pt-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setActiveTab('queue')}
              className={`px-3 py-1.5 text-xs rounded border ${activeTab === 'queue' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              队列
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-3 py-1.5 text-xs rounded border ${activeTab === 'results' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              结果收件箱 ({currentBookResults.length})
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pb-3">
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              草稿字数档位
              <select
                value={draftLength}
                onChange={(e) => setDraftLength(e.target.value as 'short' | 'medium' | 'long')}
                className="bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground"
              >
                <option value="short">短</option>
                <option value="medium">中</option>
                <option value="long">长</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              上下文窗口
              <select
                value={contextLimit}
                onChange={(e) => setContextLimit(Number(e.target.value))}
                className="bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground"
              >
                <option value={3}>3 场景</option>
                <option value={5}>5 场景</option>
                <option value={8}>8 场景</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              润色范围
              <select
                value={polishRange}
                onChange={(e) => setPolishRange(e.target.value as 'selection' | 'scene')}
                className="bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground"
              >
                <option value="scene">整场景</option>
                <option value="selection">选区</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              提示词方案
              <select
                value={promptProfileId}
                onChange={(e) => setPromptProfileId(e.target.value)}
                className="bg-secondary border border-border rounded px-2 py-1.5 text-xs text-foreground"
              >
                {promptProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {activeTab === 'queue' ? (
          <>
            <div className="p-4 border-b border-border bg-background/30">
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => addTask('expansion')}
                  disabled={!canExpand}
                  className="px-3 py-2 text-xs rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
                >
                  加入扩写任务
                </button>
                <button
                  onClick={() => addTask('draft')}
                  disabled={!canDraft}
                  className="px-3 py-2 text-xs rounded-lg bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 disabled:opacity-40"
                >
                  加入草稿任务
                </button>
                <button
                  onClick={() => addTask('polish')}
                  disabled={!canPolish}
                  className="px-3 py-2 text-xs rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 disabled:opacity-40"
                >
                  加入润色任务
                </button>
                <button
                  onClick={() => { void addBatchExpansionForCurrentLevel(); }}
                  disabled={!canExpand}
                  className="px-3 py-2 text-xs rounded-lg bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20 disabled:opacity-40"
                >
                  同层批量扩写
                </button>
                <button
                  onClick={() => { void addBatchSceneTasksForChapter('draft'); }}
                  disabled={!canDraft}
                  className="px-3 py-2 text-xs rounded-lg bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 disabled:opacity-40"
                >
                  本章批量草稿
                </button>
                <button
                  onClick={() => { void addBatchSceneTasksForChapter('polish'); }}
                  disabled={!canDraft}
                  className="px-3 py-2 text-xs rounded-lg bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 disabled:opacity-40"
                >
                  本章批量润色
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTaskQueuePaused(!isTaskQueuePaused)}
                  className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 text-foreground"
                >
                  {isTaskQueuePaused ? '恢复队列' : '暂停队列'}
                </button>
                <button
                  onClick={clearCompletedTasks}
                  className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                >
                  清理已完成
                </button>
                <label className="flex items-center gap-1 text-xs text-muted-foreground ml-1">
                  并发
                  <select
                    value={taskQueueConcurrency}
                    onChange={(e) => setTaskQueueConcurrency(Number(e.target.value))}
                    className="bg-secondary border border-border rounded px-2 py-1 text-xs text-foreground"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <span className="text-xs text-muted-foreground ml-2">
                  状态：{isTaskQueuePaused ? '已暂停' : isTaskQueueRunning ? `执行中(并发${taskQueueConcurrency})` : '空闲'}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {taskQueue.length === 0 && (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                  暂无任务，先从当前节点加入一条任务。
                </div>
              )}

              {taskQueue.map((task) => (
                <div key={task.id} className="border border-border rounded-xl p-3 bg-secondary/20">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{task.nodeTitle}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {task.type === 'expansion' ? '扩写' : task.type === 'draft' ? '草稿' : '润色'} · {new Date(task.createdAt).toLocaleTimeString()}
                      </div>
                      {renderTaskParams(task)}
                    </div>
                    <span className={`px-2 py-1 text-[10px] rounded-full ${statusMap[task.status].className}`}>
                      {statusMap[task.status].label}
                    </span>
                  </div>

                  {task.error && <div className="text-xs text-red-500 mt-2">{task.error}</div>}

                  <div className="flex items-center gap-2 mt-3">
                    {task.status === 'failed' && (
                      <button
                        onClick={() => updateTaskStatus(task.id, 'pending')}
                        className="px-2.5 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        重试
                      </button>
                    )}
                    {(task.status === 'pending' || task.status === 'failed' || task.status === 'completed' || task.status === 'cancelled') && (
                      <button
                        onClick={() => removeTask(task.id)}
                        className="px-2.5 py-1 text-xs rounded bg-secondary text-muted-foreground hover:text-foreground"
                      >
                        移除
                      </button>
                    )}
                    {task.status === 'pending' && (
                      <button
                        onClick={() => updateTaskStatus(task.id, 'cancelled')}
                        className="px-2.5 py-1 text-xs rounded bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {currentBookResults.length === 0 && (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                暂无可处理任务结果。
              </div>
            )}

            {currentBookResults.map((result) => {
              const expanded = previewResultId === result.id;
              return (
                <div key={result.id} className="border border-border rounded-xl p-3 bg-secondary/20">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-foreground">{result.nodeTitle}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {result.type === 'expansion' ? '扩写结果' : result.type === 'draft' ? '草稿结果' : '润色结果'} · {new Date(result.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPreviewResultId(expanded ? null : result.id)}
                        className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                      >
                        {expanded ? '收起预览' : '预览'}
                      </button>
                      <button
                        onClick={() => { void applyTaskResult(result.id); }}
                        className="px-2.5 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        应用
                      </button>
                      <button
                        onClick={() => discardTaskResult(result.id)}
                        className="px-2.5 py-1 text-xs rounded bg-secondary text-muted-foreground hover:text-foreground"
                      >
                        丢弃
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 border-t border-border pt-3">
                      {result.payload.kind === 'expansion' ? (
                        <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                          {result.payload.nodes.map((item, index) => (
                            <div key={`${result.id}-${index}`} className="rounded border border-border bg-background/40 px-3 py-2">
                              <div className="text-xs font-medium text-foreground">{item.title}</div>
                              <div className="text-[11px] text-muted-foreground mt-1 whitespace-pre-wrap leading-5">{item.summary}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="max-h-[360px] overflow-auto scrollbar-thin">
                          <DiffViewer
                            oldText={result.payload.originalContent}
                            newText={result.payload.generatedContent}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
