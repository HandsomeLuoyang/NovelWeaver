import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './Icons';
import { NodeType } from '../types';

interface NodeCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (title: string, summary: string) => void;
  nodeType: NodeType;
}

const getNodeTypeName = (type: NodeType) => {
  switch (type) {
    case 'volume': return '卷';
    case 'arc': return '大剧情';
    case 'chapter': return '章';
    case 'scene': return '场景';
    default: return type;
  }
};

export const NodeCreateModal: React.FC<NodeCreateModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  nodeType
}) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onConfirm(title, summary);
    setTitle('');
    setSummary('');
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/60">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <span className="p-1.5 bg-primary/10 rounded-md text-primary">
                <Icons.Plus className="w-5 h-5" />
              </span>
              创建新{getNodeTypeName(nodeType)}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-5 flex-1 overflow-y-auto bg-background/40">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                标题 <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`例如：第一${getNodeTypeName(nodeType)} - [核心事件]`}
                className="w-full px-4 py-3 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                梗概/简介
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="简要描述这个节点的主要内容、剧情走向或核心冲突..."
                rows={8}
                className="w-full px-4 py-3 rounded-lg border border-border bg-input text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border flex justify-end gap-3 bg-card/60">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!title.trim()}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              <Icons.Check className="w-4 h-4" />
              立即创建
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
};
