import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createAutoSnapshotForParent, db } from '../db';
import { StoryNode } from '../types';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface SceneColumn {
  chapterId: string;
  chapterTitle: string;
  scenes: StoryNode[];
}

interface SceneBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
}

interface DragState {
  sceneId: string;
  fromChapterId: string;
}

const serializeColumns = (columns: SceneColumn[]) => {
  return JSON.stringify(
    columns.map((column) => ({
      chapterId: column.chapterId,
      sceneIds: column.scenes.map((scene) => scene.id)
    }))
  );
};

export const SceneBoardModal: React.FC<SceneBoardModalProps> = ({
  isOpen,
  onClose,
  bookId,
}) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [columns, setColumns] = useState<SceneColumn[]>([]);
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const load = async () => {
      setLoading(true);
      try {
        const nodes = await db.nodes.where('bookId').equals(bookId).toArray();
        const chapters = nodes
          .filter((node) => node.type === 'chapter')
          .sort((a, b) => a.order - b.order);

        const nextColumns: SceneColumn[] = chapters.map((chapter) => ({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          scenes: nodes
            .filter((node) => node.type === 'scene' && node.parentId === chapter.id)
            .sort((a, b) => a.order - b.order)
        }));

        setColumns(nextColumns);
        setInitialSnapshot(serializeColumns(nextColumns));
      } catch (error) {
        console.error(error);
        toast.error('加载场景看板失败');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [bookId, isOpen]);

  if (!isOpen) return null;

  const moveScene = (sceneId: string, fromChapterId: string, toChapterId: string, toIndex: number) => {
    if (fromChapterId === toChapterId && toIndex < 0) return;

    setColumns((prev) => {
      const draft = prev.map((column) => ({ ...column, scenes: [...column.scenes] }));
      const fromColumn = draft.find((column) => column.chapterId === fromChapterId);
      const toColumn = draft.find((column) => column.chapterId === toChapterId);
      if (!fromColumn || !toColumn) return prev;

      const sourceIndex = fromColumn.scenes.findIndex((scene) => scene.id === sceneId);
      if (sourceIndex < 0) return prev;

      const [movedScene] = fromColumn.scenes.splice(sourceIndex, 1);
      if (!movedScene) return prev;

      const safeIndex = Math.max(0, Math.min(toIndex, toColumn.scenes.length));
      toColumn.scenes.splice(safeIndex, 0, {
        ...movedScene,
        parentId: toChapterId,
      });

      return draft;
    });
  };

  const handleDrop = (targetChapterId: string, targetIndex: number) => {
    if (!dragState) return;

    moveScene(dragState.sceneId, dragState.fromChapterId, targetChapterId, targetIndex);
    setDragState(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const changedChapterIds = new Set<string>();
      const currentSnapshot = serializeColumns(columns);
      if (currentSnapshot === initialSnapshot) {
        toast.info('当前没有排序变更');
        onClose();
        return;
      }

      const initial = JSON.parse(initialSnapshot) as Array<{ chapterId: string; sceneIds: string[] }>;
      const next = JSON.parse(currentSnapshot) as Array<{ chapterId: string; sceneIds: string[] }>;
      const initialMap = new Map(initial.map((row) => [row.chapterId, row.sceneIds.join(',')]));

      next.forEach((row) => {
        const old = initialMap.get(row.chapterId) || '';
        const current = row.sceneIds.join(',');
        if (old !== current) {
          changedChapterIds.add(row.chapterId);
        }
      });

      for (const chapterId of changedChapterIds) {
        await createAutoSnapshotForParent(chapterId, 'scene-board');
      }

      await db.transaction('rw', db.nodes, async () => {
        for (const column of columns) {
          for (let index = 0; index < column.scenes.length; index += 1) {
            const scene = column.scenes[index];
            await db.nodes.update(scene.id, {
              parentId: column.chapterId,
              order: index,
            });
          }
        }
      });

      toast.success('场景重排已保存');
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('保存场景排序失败');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[115] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[92vw] h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Layout size={18} className="text-cyan-500" />
              场景看板
            </h3>
            <p className="text-xs text-muted-foreground mt-1">支持跨章节拖拽重排场景，保存后自动生成结构快照</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4 bg-background/30">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
          )}

          {!loading && columns.length === 0 && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              还没有章节节点，先在大纲中创建章节后再管理场景。
            </div>
          )}

          {!loading && columns.length > 0 && (
            <div className="h-full overflow-x-scroll overflow-y-hidden pb-3 scrollbar-thin scene-board-scroll">
              <div className="h-full flex items-start gap-4 min-w-max pr-2">
              {columns.map((column) => (
                <div
                  key={column.chapterId}
                  className="w-[320px] h-full bg-card border border-border rounded-xl flex flex-col"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(column.chapterId, column.scenes.length);
                  }}
                >
                  <div className="px-3 py-2 border-b border-border bg-secondary/40">
                    <div className="text-sm font-semibold text-foreground truncate">{column.chapterTitle}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{column.scenes.length} 个场景</div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin">
                    {column.scenes.map((scene, index) => (
                      <div
                        key={scene.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', scene.id);
                          setDragState({ sceneId: scene.id, fromChapterId: column.chapterId });
                        }}
                        onDragEnd={() => setDragState(null)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          handleDrop(column.chapterId, index);
                        }}
                        className="border border-border rounded-lg bg-background p-3 cursor-move hover:border-primary/40 hover:bg-secondary/30 transition-colors"
                      >
                        <div className="text-xs font-semibold text-foreground">{scene.title}</div>
                        <div className="text-[11px] text-muted-foreground line-clamp-3 mt-1">{scene.summary}</div>
                      </div>
                    ))}

                    {column.scenes.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-lg">
                        拖拽场景到这里
                      </div>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-card/70 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md bg-secondary text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存重排'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
