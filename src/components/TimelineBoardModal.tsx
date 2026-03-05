import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Book, StoryNode } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface TimelineBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  onJumpToNode?: (nodeId: string) => void;
}

const extractDayIndex = (text: string): number | null => {
  const patterns = [/第\s*(\d+)\s*天/i, /day\s*(\d+)/i, /d\s*(\d{1,3})\b/i];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
};

const buildLinearScenes = (nodes: StoryNode[]) => {
  const byParent = new Map<string | null, StoryNode[]>();
  nodes.forEach((node) => {
    const key = node.parentId;
    const bucket = byParent.get(key) || [];
    bucket.push(node);
    byParent.set(key, bucket);
  });
  byParent.forEach((bucket) => bucket.sort((a, b) => a.order - b.order));

  const walk = (parentId: string | null): StoryNode[] => {
    const children = byParent.get(parentId) || [];
    return children.flatMap((child) => {
      if (child.type === 'scene') return [child];
      return walk(child.id);
    });
  };

  return walk(null);
};

export const TimelineBoardModal: React.FC<TimelineBoardModalProps> = ({
  isOpen,
  onClose,
  book,
  onJumpToNode,
}) => {
  const toast = useToast();
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);

  const nodes = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    return db.nodes.where('bookId').equals(book.id).toArray();
  }, [isOpen, book?.id]) || [];

  const scenes = useMemo(() => buildLinearScenes(nodes), [nodes]);

  const timelineRows = useMemo(() => {
    let lastDay: number | null = null;
    return scenes.map((scene) => {
      const source = `${scene.meta?.timeTag || ''}\n${scene.title}\n${scene.summary}`;
      const day = extractDayIndex(source);
      const regressed = day !== null && lastDay !== null && day < lastDay;
      if (day !== null) {
        lastDay = day;
      }
      return {
        scene,
        day,
        regressed,
      };
    });
  }, [scenes]);

  if (!isOpen || !book) return null;

  const updateSceneMeta = async (sceneId: string, patch: Partial<NonNullable<StoryNode['meta']>>) => {
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    setSavingNodeId(sceneId);
    try {
      await db.nodes.update(sceneId, {
        meta: {
          ...(scene.meta || {}),
          ...patch,
        },
      });
    } finally {
      setSavingNodeId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[128] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[86vh] border border-border bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col ui-rise-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Calendar size={18} className="text-primary" />
              时间线看板
            </h3>
            <p className="text-xs text-muted-foreground mt-1">按剧情顺序检查场景时间流，快速修正 timeTag 与地点</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground bg-background/40">
          场景数：{scenes.length} · 回退风险：{timelineRows.filter((row) => row.regressed).length}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
          {timelineRows.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-10 border border-dashed border-border rounded-lg bg-secondary/20">
              暂无场景
            </div>
          )}

          {timelineRows.map(({ scene, day, regressed }, index) => (
            <div key={scene.id} className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{index + 1}. {scene.title}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span className={`px-2 py-0.5 rounded-full border ${day !== null ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}>
                      {day !== null ? `第 ${day} 天` : '未标注日序'}
                    </span>
                    {regressed && (
                      <span className="px-2 py-0.5 rounded-full border border-amber-500/40 text-amber-400 bg-amber-500/10">
                        时间疑似回退
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onJumpToNode?.(scene.id)}
                    className="px-2 py-1 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    定位
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="text-[11px] text-muted-foreground">
                  时间标记
                  <input
                    value={scene.meta?.timeTag || ''}
                    onChange={(e) => { void updateSceneMeta(scene.id, { timeTag: e.target.value }); }}
                    className="mt-1 w-full bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
                    placeholder="例如：第3天 黄昏"
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  地点
                  <input
                    value={scene.meta?.location || ''}
                    onChange={(e) => { void updateSceneMeta(scene.id, { location: e.target.value }); }}
                    className="mt-1 w-full bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
                    placeholder="例如：霜港码头"
                  />
                </label>
              </div>

              {savingNodeId === scene.id && (
                <div className="mt-2 text-[11px] text-muted-foreground">保存中...</div>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-border bg-card/70 flex justify-end">
          <button
            onClick={() => toast.success('时间线数据已实时保存')}
            className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
