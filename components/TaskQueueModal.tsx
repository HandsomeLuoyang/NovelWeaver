import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { StoryNode } from '../types';
import { useToast } from '../hooks/useToast';
import { Icons } from './Icons';

interface TaskQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: StoryNode | null;
}

const statusMap = {
  pending: { label: '等待中', className: 'text-zinc-500 bg-zinc-500/10' },
  running: { label: '执行中', className: 'text-blue-500 bg-blue-500/10' },
  completed: { label: '已完成', className: 'text-emerald-500 bg-emerald-500/10' },
  failed: { label: '失败', className: 'text-red-500 bg-red-500/10' },
  cancelled: { label: '已取消', className: 'text-amber-500 bg-amber-500/10' },
} as const;

export const TaskQueueModal: React.FC<TaskQueueModalProps> = ({ isOpen, onClose, node }) => {
  const {
    currentBook,
    taskQueue,
    isTaskQueuePaused,
    isTaskQueueRunning,
    enqueueTask,
    updateTaskStatus,
    removeTask,
    clearCompletedTasks,
    setTaskQueuePaused,
  } = useStore();
  const toast = useToast();

  if (!isOpen) return null;

  const canExpand = node && node.type !== 'scene';
  const canDraft = node && node.type === 'scene';
  const canPolish = node && node.type === 'scene' && Boolean(node.content?.trim());

  const addTask = (type: 'expansion' | 'draft' | 'polish') => {
    if (!currentBook || !node) return;

    const duplicate = taskQueue.some((task) =>
      task.bookId === currentBook.id &&
      task.nodeId === node.id &&
      task.type === type &&
      (task.status === 'pending' || task.status === 'running')
    );

    if (duplicate) {
      toast.warning('队列中已存在相同任务');
      return;
    }

    enqueueTask({
      type,
      bookId: currentBook.id,
      nodeId: node.id,
      nodeTitle: node.title,
    });

    toast.success('任务已加入队列');
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[82vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Layers size={18} className="text-primary" />
              AI 任务队列
            </h3>
            <p className="text-xs text-muted-foreground mt-1">支持扩写 / 草稿 / 润色任务串行执行</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-border bg-background/40">
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
            <span className="text-xs text-muted-foreground ml-2">
              状态：{isTaskQueuePaused ? '已暂停' : isTaskQueueRunning ? '执行中' : '空闲'}
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
      </div>
    </div>,
    document.body
  );
};
