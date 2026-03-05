import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Book, DeletedBookEntry } from '../types';
import {
  getDeletedBooks,
  permanentlyDeleteBookFromRecycleBin,
  restoreBookFromRecycleBin,
} from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface BookRecycleBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored: (book: Book) => void;
}

export const BookRecycleBinModal: React.FC<BookRecycleBinModalProps> = ({
  isOpen,
  onClose,
  onRestored,
}) => {
  const toast = useToast();
  const [entries, setEntries] = useState<DeletedBookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const load = async () => {
      setLoading(true);
      try {
        const data = await getDeletedBooks();
        setEntries(data);
      } catch (error) {
        console.error(error);
        toast.error('加载书籍回收站失败');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRestore = async (entry: DeletedBookEntry) => {
    setProcessingId(entry.id);
    try {
      const restoredBook = await restoreBookFromRecycleBin(entry.id);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      onRestored(restoredBook);
      toast.success(`已恢复《${restoredBook.title}》`);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || '恢复失败');
    } finally {
      setProcessingId(null);
    }
  };

  const handlePurge = async (entry: DeletedBookEntry) => {
    if (!window.confirm(`确定彻底删除《${entry.title}》的回收记录吗？此操作不可恢复。`)) return;

    setProcessingId(entry.id);
    try {
      await permanentlyDeleteBookFromRecycleBin(entry.id);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      toast.info('回收记录已彻底删除');
    } catch (error) {
      console.error(error);
      toast.error('彻底删除失败');
    } finally {
      setProcessingId(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-[78vh] border border-border bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col ui-rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Trash2 size={18} className="text-amber-500" />
              书籍回收站
            </h3>
            <p className="text-xs text-muted-foreground mt-1">删除后的书籍会先进入回收站，可恢复或彻底删除</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
          )}

          {!loading && entries.length === 0 && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
              回收站是空的
            </div>
          )}

          {!loading && entries.map((entry) => {
            const isProcessing = processingId === entry.id;
            return (
              <div key={entry.id} className="border border-border rounded-xl p-4 bg-secondary/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{entry.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      删除时间：{new Date(entry.deletedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      节点数：{entry.data.nodes.length} · 历史：{entry.data.history.length}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestore(entry)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => handlePurge(entry)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
};
