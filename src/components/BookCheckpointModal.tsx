import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookCheckpoint } from '../types';
import { createBookCheckpoint, getBookCheckpoints, db } from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface BookCheckpointModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string | null;
}

export const BookCheckpointModal: React.FC<BookCheckpointModalProps> = ({ isOpen, onClose, bookId }) => {
  const toast = useToast();
  const [checkpoints, setCheckpoints] = useState<BookCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentNodeCount, setCurrentNodeCount] = useState(0);
  const [currentWordCount, setCurrentWordCount] = useState(0);

  useEffect(() => {
    if (!isOpen || !bookId) return;

    const load = async () => {
      setLoading(true);
      try {
        const [items, nodes, book] = await Promise.all([
          getBookCheckpoints(bookId),
          db.nodes.where('bookId').equals(bookId).toArray(),
          db.books.get(bookId),
        ]);
        setCheckpoints(items);
        setCurrentNodeCount(nodes.length);
        setCurrentWordCount(book?.wordCount || 0);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [bookId, isOpen]);

  const selected = useMemo(
    () => checkpoints.find((item) => item.id === selectedId) || checkpoints[0] || null,
    [checkpoints, selectedId]
  );

  if (!isOpen || !bookId) return null;

  const handleCreate = async () => {
    try {
      const checkpoint = await createBookCheckpoint(bookId, draftName.trim());
      setDraftName('');
      setCheckpoints((prev) => [checkpoint, ...prev]);
      setSelectedId(checkpoint.id);
      toast.success('已创建全书检查点');
    } catch (error) {
      console.error(error);
      toast.error('创建检查点失败');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-5xl h-[80vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col ui-rise-in" onClick={(event) => event.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border bg-card/80 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.History size={18} className="text-primary" />
              全书版本点
            </h3>
            <p className="text-xs text-muted-foreground mt-1">创建命名检查点，查看与当前版本的差异概览。</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-border bg-background/40 flex items-center gap-3">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="给这次版本点命名，例如：大改前 / 第一卷定稿"
            className="flex-1 rounded-xl border border-border bg-secondary/20 px-4 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
          />
          <button onClick={() => { void handleCreate(); }} className="px-4 py-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 text-sm">
            创建检查点
          </button>
        </div>

        <div className="flex-1 grid grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
          <div className="border-r border-border overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {loading && <div className="text-sm text-muted-foreground">加载中...</div>}
            {!loading && checkpoints.length === 0 && <div className="text-sm text-muted-foreground italic">还没有版本点。</div>}
            {checkpoints.map((checkpoint) => (
              <button
                key={checkpoint.id}
                onClick={() => setSelectedId(checkpoint.id)}
                className={`w-full text-left rounded-xl border px-3 py-3 transition-colors ${
                  selected?.id === checkpoint.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-secondary/15 hover:bg-secondary/30'
                }`}
              >
                <div className="text-sm font-semibold text-foreground">{checkpoint.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{new Date(checkpoint.createdAt).toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  {checkpoint.nodeCount} 节点 · {checkpoint.wordCount.toLocaleString()} 字
                </div>
              </button>
            ))}
          </div>

          <div className="overflow-y-auto p-6 scrollbar-thin">
            {selected ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
                    <div className="text-xs text-muted-foreground">当前节点数</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{currentNodeCount}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
                    <div className="text-xs text-muted-foreground">检查点节点数</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{selected.nodeCount}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
                    <div className="text-xs text-muted-foreground">差异</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{currentNodeCount - selected.nodeCount >= 0 ? '+' : ''}{currentNodeCount - selected.nodeCount}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
                    <div className="text-xs text-muted-foreground">当前字数</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{currentWordCount.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
                    <div className="text-xs text-muted-foreground">检查点字数</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{selected.wordCount.toLocaleString()}</div>
                  </div>
                  <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
                    <div className="text-xs text-muted-foreground">差异</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{currentWordCount - selected.wordCount >= 0 ? '+' : ''}{(currentWordCount - selected.wordCount).toLocaleString()}</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-secondary/10 p-5 space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">检查点摘要</h4>
                  <div className="text-sm text-muted-foreground leading-7">
                    《{selected.payload.book.title}》在该检查点包含 {selected.payload.book.characters.length} 位角色、{selected.payload.facts.length} 条事实、{selected.payload.foreshadows.length} 条伏笔、{selected.payload.materials.length} 条素材。
                  </div>
                  <div className="text-xs text-muted-foreground">
                    当前版本相较该检查点的变化主要体现在字数和节点规模；详细内容对比将在后续版本继续增强。
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">选择左侧检查点查看差异。</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
