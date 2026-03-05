import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Book, StoryNode } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface CharacterArcBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  onBookUpdate: (book: Book) => void;
  onJumpToNode?: (nodeId: string) => void;
}

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

export const CharacterArcBoardModal: React.FC<CharacterArcBoardModalProps> = ({
  isOpen,
  onClose,
  book,
  onBookUpdate,
  onJumpToNode,
}) => {
  const toast = useToast();
  const [savingName, setSavingName] = useState<string | null>(null);

  const nodes = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    return db.nodes.where('bookId').equals(book.id).toArray();
  }, [isOpen, book?.id]) || [];

  const linearScenes = useMemo(() => buildLinearScenes(nodes), [nodes]);

  const charRows = useMemo(() => {
    if (!book) return [];
    return book.characters.map((character) => {
      const name = character.name.trim();
      const scenes = linearScenes.filter((scene) => {
        if (!name) return false;
        const participants = scene.meta?.participants || [];
        if (participants.includes(name)) return true;
        const source = `${scene.title}\n${scene.summary}\n${scene.content || ''}`;
        return source.includes(name);
      });
      return {
        character,
        scenes,
        arcNote: (book.characterArcNotes || {})[name] || '',
      };
    });
  }, [book, linearScenes]);

  if (!isOpen || !book) return null;

  const updateArcNote = async (name: string, value: string) => {
    setSavingName(name);
    try {
      const nextBook: Book = {
        ...book,
        characterArcNotes: {
          ...(book.characterArcNotes || {}),
          [name]: value,
        },
      };
      await db.books.put(nextBook);
      onBookUpdate(nextBook);
    } finally {
      setSavingName(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[129] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Users size={18} className="text-primary" />
              角色弧线看板
            </h3>
            <p className="text-xs text-muted-foreground mt-1">按角色查看出场轨迹，并维护弧线笔记</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {charRows.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-10 border border-dashed border-border rounded-lg bg-secondary/20">
              当前书籍暂无角色
            </div>
          )}

          {charRows.map(({ character, scenes, arcNote }) => (
            <div key={character.name} className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">{character.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{character.role || '未设定角色定位'}</div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  出场 {scenes.length} 场
                </div>
              </div>

              <label className="mt-2 block text-[11px] text-muted-foreground">
                弧线笔记
                <textarea
                  defaultValue={arcNote}
                  onBlur={(e) => { void updateArcNote(character.name, e.target.value.trim()); }}
                  className="mt-1 w-full min-h-[70px] bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground leading-6"
                  placeholder="记录这个角色当前阶段的心理变化、目标偏移与关键转折。"
                />
              </label>

              <div className="mt-2 space-y-1.5 max-h-44 overflow-y-auto pr-1 scrollbar-thin">
                {scenes.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic">尚未在场景中出现</div>
                ) : (
                  scenes.map((scene, index) => (
                    <div key={scene.id} className="rounded border border-border/70 bg-background/50 px-2 py-1.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-foreground truncate">{index + 1}. {scene.title}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{scene.meta?.timeTag || '未标注时间'} · {scene.meta?.location || '未标注地点'}</div>
                      </div>
                      <button
                        onClick={() => onJumpToNode?.(scene.id)}
                        className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        定位
                      </button>
                    </div>
                  ))
                )}
              </div>

              {savingName === character.name && (
                <div className="mt-2 text-[11px] text-muted-foreground">保存中...</div>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-border bg-card/70 flex justify-end">
          <button
            onClick={() => toast.success('角色弧线笔记已保存')}
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
