import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createAutoSnapshotForParent, db } from '../db';
import { StoryNode } from '../types';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';
import { moveSceneInColumns, moveScenesInColumns } from '../services/sceneBoard';

type LaneMode = 'chapter' | 'pov' | 'location' | 'conflict';

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
  sceneIds: string[];
  fromChapterId: string;
}

const serializeColumns = (columns: SceneColumn[]) => {
  return JSON.stringify(
    columns.map((column) => ({
      chapterId: column.chapterId,
      scenes: column.scenes.map((scene) => ({
        id: scene.id,
        parentId: scene.parentId,
        order: scene.order,
        pov: scene.meta?.pov || '',
        location: scene.meta?.location || '',
        conflictType: scene.meta?.conflictType || '',
      })),
    }))
  );
};

const serializeStructure = (columns: SceneColumn[]) => {
  return JSON.stringify(
    columns.map((column) => ({
      chapterId: column.chapterId,
      sceneIds: column.scenes.map((scene) => scene.id),
    }))
  );
};

const resolveInsertIndex = (event: React.DragEvent<HTMLDivElement>, index: number) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const dropInBottomHalf = event.clientY > rect.top + rect.height / 2;
  return dropInBottomHalf ? index + 1 : index;
};

const laneLabel: Record<LaneMode, string> = {
  chapter: '按章节',
  pov: '按 POV',
  location: '按地点',
  conflict: '按冲突',
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
  const [initialStructureSnapshot, setInitialStructureSnapshot] = useState('');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [laneMode, setLaneMode] = useState<LaneMode>('chapter');
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [lastSelectedSceneId, setLastSelectedSceneId] = useState<string | null>(null);
  const [batchPov, setBatchPov] = useState('');
  const [batchLocation, setBatchLocation] = useState('');
  const [batchConflictType, setBatchConflictType] = useState('');

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
            .sort((a, b) => a.order - b.order),
        }));

        setColumns(nextColumns);
        setInitialSnapshot(serializeColumns(nextColumns));
        setInitialStructureSnapshot(serializeStructure(nextColumns));
        setSelectedSceneIds([]);
        setLastSelectedSceneId(null);
      } catch (error) {
        console.error(error);
        toast.error('加载场景看板失败');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [bookId, isOpen]);

  const laneColumns = useMemo(() => {
    if (laneMode === 'chapter') return [] as Array<{ key: string; title: string; scenes: Array<StoryNode & { chapterTitle: string }> }>;

    const allScenes = columns.flatMap((column) =>
      column.scenes.map((scene) => ({
        ...scene,
        chapterTitle: column.chapterTitle,
      }))
    );

    const grouped = new Map<string, Array<StoryNode & { chapterTitle: string }>>();
    allScenes.forEach((scene) => {
      const key = (() => {
        if (laneMode === 'pov') return scene.meta?.pov?.trim();
        if (laneMode === 'location') return scene.meta?.location?.trim();
        return scene.meta?.conflictType?.trim();
      })();
      const normalizedKey = key && key.length > 0 ? key : '未标注';
      const bucket = grouped.get(normalizedKey) || [];
      bucket.push(scene);
      grouped.set(normalizedKey, bucket);
    });

    return Array.from(grouped.entries())
      .map(([key, scenes]) => ({
        key,
        title: key,
        scenes,
      }))
      .sort((a, b) => b.scenes.length - a.scenes.length || a.title.localeCompare(b.title));
  }, [columns, laneMode]);

  if (!isOpen) return null;

  const moveScenes = (sceneIds: string[], fromChapterId: string, toChapterId: string, toIndex: number) => {
    if (sceneIds.length === 0) return;
    setColumns((prev) => {
      if (sceneIds.length === 1) {
        return moveSceneInColumns(prev, sceneIds[0], fromChapterId, toChapterId, toIndex);
      }
      return moveScenesInColumns(prev, sceneIds, fromChapterId, toChapterId, toIndex);
    });
  };

  const handleDrop = (targetChapterId: string, targetIndex: number) => {
    if (!dragState) return;
    moveScenes(dragState.sceneIds, dragState.fromChapterId, targetChapterId, targetIndex);
    setDragState(null);
  };

  const handleSceneSelect = (
    chapterId: string,
    sceneId: string,
    sceneIndex: number,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const chapter = columns.find((item) => item.chapterId === chapterId);
    if (!chapter) return;

    if (event.shiftKey && lastSelectedSceneId) {
      const lastIndex = chapter.scenes.findIndex((scene) => scene.id === lastSelectedSceneId);
      if (lastIndex >= 0) {
        const [start, end] = [Math.min(lastIndex, sceneIndex), Math.max(lastIndex, sceneIndex)];
        const rangeIds = chapter.scenes.slice(start, end + 1).map((scene) => scene.id);
        setSelectedSceneIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedSceneIds((prev) => (
        prev.includes(sceneId)
          ? prev.filter((id) => id !== sceneId)
          : [...prev, sceneId]
      ));
      setLastSelectedSceneId(sceneId);
      return;
    }

    setSelectedSceneIds([sceneId]);
    setLastSelectedSceneId(sceneId);
  };

  const applyBatchMeta = () => {
    if (selectedSceneIds.length === 0) return;

    const patch: NonNullable<StoryNode['meta']> = {};
    if (batchPov.trim()) patch.pov = batchPov.trim();
    if (batchLocation.trim()) patch.location = batchLocation.trim();
    if (batchConflictType.trim()) patch.conflictType = batchConflictType.trim();

    if (Object.keys(patch).length === 0) {
      toast.info('请至少填写一个要批量更新的字段');
      return;
    }

    setColumns((prev) => prev.map((column) => ({
      ...column,
      scenes: column.scenes.map((scene) => (
        selectedSceneIds.includes(scene.id)
          ? { ...scene, meta: { ...(scene.meta || {}), ...patch } }
          : scene
      )),
    })));

    toast.success(`已批量更新 ${selectedSceneIds.length} 个场景元数据`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const currentSnapshot = serializeColumns(columns);
      if (currentSnapshot === initialSnapshot) {
        toast.info('当前没有变更');
        onClose();
        return;
      }

      const changedChapterIds = new Set<string>();
      const structureSnapshot = serializeStructure(columns);
      if (structureSnapshot !== initialStructureSnapshot) {
        const initial = JSON.parse(initialStructureSnapshot) as Array<{ chapterId: string; sceneIds: string[] }>;
        const next = JSON.parse(structureSnapshot) as Array<{ chapterId: string; sceneIds: string[] }>;
        const initialMap = new Map(initial.map((row) => [row.chapterId, row.sceneIds.join(',')]));

        next.forEach((row) => {
          const old = initialMap.get(row.chapterId) || '';
          const current = row.sceneIds.join(',');
          if (old !== current) {
            changedChapterIds.add(row.chapterId);
          }
        });
      }

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
              meta: {
                ...(scene.meta || {}),
              },
            });
          }
        }
      });

      toast.success('场景看板变更已保存');
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('保存场景看板失败');
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
        className="w-full max-w-[94vw] h-[90vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Layout size={18} className="text-cyan-500" />
              场景看板
            </h3>
            <p className="text-xs text-muted-foreground mt-1">支持多选拖拽、泳道浏览与批量元数据编辑</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-border bg-background/40 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(['chapter', 'pov', 'location', 'conflict'] as LaneMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setLaneMode(mode)}
                className={`px-3 py-1.5 text-xs rounded border ${laneMode === mode ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {laneLabel[mode]}
              </button>
            ))}
            <span className="text-xs text-muted-foreground ml-2">已选 {selectedSceneIds.length} 个场景</span>
            {selectedSceneIds.length > 0 && (
              <button
                onClick={() => setSelectedSceneIds([])}
                className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
              >
                清空选择
              </button>
            )}
          </div>

          {selectedSceneIds.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                POV
                <input
                  value={batchPov}
                  onChange={(e) => setBatchPov(e.target.value)}
                  className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
                  placeholder="如：林秋"
                />
              </label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                地点
                <input
                  value={batchLocation}
                  onChange={(e) => setBatchLocation(e.target.value)}
                  className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
                  placeholder="如：旧城站"
                />
              </label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                冲突类型
                <input
                  value={batchConflictType}
                  onChange={(e) => setBatchConflictType(e.target.value)}
                  className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
                  placeholder="如：对抗"
                />
              </label>
              <button
                onClick={applyBatchMeta}
                className="px-3 py-2 text-xs rounded bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20"
              >
                批量应用元数据
              </button>
            </div>
          )}
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

          {!loading && columns.length > 0 && laneMode === 'chapter' && (
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
                      {column.scenes.map((scene, index) => {
                        const isSelected = selectedSceneIds.includes(scene.id);
                        return (
                          <div
                            key={scene.id}
                            draggable
                            onClick={(event) => handleSceneSelect(column.chapterId, scene.id, index, event)}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', scene.id);

                              const selectedInColumn = selectedSceneIds.filter((id) =>
                                column.scenes.some((item) => item.id === id)
                              );
                              const dragSceneIds = selectedInColumn.includes(scene.id)
                                ? selectedInColumn
                                : [scene.id];

                              setSelectedSceneIds(dragSceneIds);
                              setDragState({ sceneIds: dragSceneIds, fromChapterId: column.chapterId });
                            }}
                            onDragEnd={() => setDragState(null)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const targetIndex = resolveInsertIndex(e, index);
                              handleDrop(column.chapterId, targetIndex);
                            }}
                            className={`border rounded-lg bg-background p-3 cursor-move transition-colors ${isSelected ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-secondary/30'}`}
                          >
                            <div className="text-xs font-semibold text-foreground">{scene.title}</div>
                            <div className="text-[11px] text-muted-foreground line-clamp-3 mt-1">{scene.summary}</div>
                            <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                              {scene.meta?.pov && <span className="px-1.5 py-0.5 rounded bg-secondary">POV:{scene.meta.pov}</span>}
                              {scene.meta?.location && <span className="px-1.5 py-0.5 rounded bg-secondary">地:{scene.meta.location}</span>}
                              {scene.meta?.conflictType && <span className="px-1.5 py-0.5 rounded bg-secondary">冲突:{scene.meta.conflictType}</span>}
                            </div>
                          </div>
                        );
                      })}

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

          {!loading && columns.length > 0 && laneMode !== 'chapter' && (
            <div className="h-full overflow-x-scroll overflow-y-hidden pb-3 scrollbar-thin scene-board-scroll">
              <div className="h-full flex items-start gap-4 min-w-max pr-2">
                {laneColumns.map((lane) => (
                  <div key={lane.key} className="w-[320px] h-full bg-card border border-border rounded-xl flex flex-col">
                    <div className="px-3 py-2 border-b border-border bg-secondary/40">
                      <div className="text-sm font-semibold text-foreground truncate">{lane.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-1">{lane.scenes.length} 个场景</div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin">
                      {lane.scenes.map((scene) => {
                        const isSelected = selectedSceneIds.includes(scene.id);
                        return (
                          <div
                            key={`${lane.key}-${scene.id}`}
                            onClick={() => {
                              setSelectedSceneIds((prev) => (
                                prev.includes(scene.id)
                                  ? prev.filter((id) => id !== scene.id)
                                  : [...prev, scene.id]
                              ));
                              setLastSelectedSceneId(scene.id);
                            }}
                            className={`border rounded-lg bg-background p-3 cursor-pointer transition-colors ${isSelected ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-secondary/30'}`}
                          >
                            <div className="text-xs font-semibold text-foreground">{scene.title}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">所属章节：{scene.chapterTitle}</div>
                            <div className="text-[11px] text-muted-foreground line-clamp-3 mt-2">{scene.summary}</div>
                          </div>
                        );
                      })}
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
            {saving ? '保存中...' : '保存看板变更'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
