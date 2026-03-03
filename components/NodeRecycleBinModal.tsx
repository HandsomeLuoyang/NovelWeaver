import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DeletedNodeEntry } from '../types';
import {
  getDeletedNodesForBook,
  permanentlyDeleteNodeFromRecycleBin,
  restoreNodeFromRecycleBin,
} from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface NodeRecycleBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  onRestored?: (nodeId: string) => void;
}

export const NodeRecycleBinModal: React.FC<NodeRecycleBinModalProps> = ({
  isOpen,
  onClose,
  bookId,
  onRestored,
}) => {
  const toast = useToast();
  const [entries, setEntries] = useState<DeletedNodeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const load = async () => {
      setLoading(true);
      try {
        const data = await getDeletedNodesForBook(bookId);
        setEntries(data);
      } catch (error) {
        console.error(error);
        toast.error('加载节点回收站失败');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [bookId, isOpen, toast]);

  if (!isOpen) return null;

  const handleRestore = async (entry: DeletedNodeEntry) => {
    setProcessingId(entry.id);
    try {
      const restoredNodeId = await restoreNodeFromRecycleBin(entry.id);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      onRestored?.(restoredNodeId);
      toast.success(`节点「${entry.rootNodeTitle}」已恢复`);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || '恢复失败');
    } finally {
      setProcessingId(null);
    }
  };

  const handlePurge = async (entry: DeletedNodeEntry) => {
    if (!window.confirm(`确定彻底删除节点「${entry.rootNodeTitle}」的回收记录吗？`)) return;

    setProcessingId(entry.id);
    try {
      await permanentlyDeleteNodeFromRecycleBin(entry.id);
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
      toast.info('节点回收记录已删除');
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
        className="w-full max-w-3xl h-[76vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Trash2 size={18} className="text-amber-500" />
              节点回收站
            </h3>
            <p className="text-xs text-muted-foreground mt-1">已删除节点子树可在此恢复</p>
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
              当前书籍没有可恢复的节点
            </div>
          )}

          {!loading && entries.map((entry) => {
            const isProcessing = processingId === entry.id;
            return (
              <div key={entry.id} className="border border-border rounded-xl p-4 bg-secondary/20">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{entry.rootNodeTitle}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      删除时间：{new Date(entry.deletedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      子树节点：{entry.data.nodes.length} · 历史：{entry.data.history.length}
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
