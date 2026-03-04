import React from 'react';
import { createPortal } from 'react-dom';
import { Book, StoryNode } from '../types';
import { Icons } from './Icons';

interface CreativeRescueModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: StoryNode | null;
  book: Book | null;
  onInsertSnippet: (text: string) => void;
  onApplyDirectionToSummary: (text: string) => void;
}

export const CreativeRescueModal: React.FC<CreativeRescueModalProps> = ({
  isOpen,
  onClose,
  node,
  book,
  onInsertSnippet,
  onApplyDirectionToSummary,
}) => {
  if (!isOpen) return null;

  const direction = node?.summary?.trim() ? `围绕“${node.summary.slice(0, 40)}”推进冲突，并给出下一步行动。` : '先给主角一个必须立刻处理的问题。';

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Icons.Sparkles size={18} className="text-primary" />
            卡文急救
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-sm text-muted-foreground">{book ? `当前作品：${book.title}` : '未选择作品'}</div>
          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="text-xs text-muted-foreground mb-2">推进方向</div>
            <div className="text-sm text-foreground leading-7">{direction}</div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => onApplyDirectionToSummary(direction)}
                className="px-3 py-1.5 text-xs rounded bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20"
              >
                写入节点摘要
              </button>
              <button
                onClick={() => onInsertSnippet(`\n\n[推进方向]\n${direction}\n`) }
                className="px-3 py-1.5 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
              >
                插入正文
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
