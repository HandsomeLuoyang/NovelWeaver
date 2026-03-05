import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Book } from '../types';
import { Icons } from './Icons';
import { generateRewriteVariants } from '../services/geminiService';
import { useToast } from '../hooks/useToast';
import { DiffViewer } from './DiffViewer';

interface RewriteWorkbenchModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  sourceText: string;
  preContext: string;
  postContext: string;
  onApplyVariant: (variant: string) => void;
}

export const RewriteWorkbenchModal: React.FC<RewriteWorkbenchModalProps> = ({
  isOpen,
  onClose,
  book,
  sourceText,
  preContext,
  postContext,
  onApplyVariant,
}) => {
  const toast = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState('');

  const activeVariant = useMemo(
    () => variants[activeIndex] || '',
    [variants, activeIndex]
  );

  if (!isOpen || !book) return null;

  const handleGenerate = async () => {
    const source = sourceText.trim();
    if (!source) {
      toast.warning('当前没有可改写文本');
      return;
    }
    setIsGenerating(true);
    setError('');
    try {
      const nextVariants = await generateRewriteVariants(
        source,
        preContext,
        postContext,
        book,
        undefined,
        { variantCount: 3 }
      );
      setVariants(nextVariants);
      setActiveIndex(0);
      toast.success('改写候选已生成');
    } catch (err: any) {
      console.error(err);
      const message = err?.message || '改写生成失败';
      setError(message);
      toast.error(message);
    } finally {
      setIsGenerating(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[131] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Wand size={18} className="text-primary" />
              改写工作台
            </h3>
            <p className="text-xs text-muted-foreground mt-1">生成 3 个候选版本，选择最合适的一版直接替换</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void handleGenerate(); }}
              disabled={isGenerating}
              className="px-3 py-1.5 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              {isGenerating ? '生成中...' : '生成候选'}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
              <Icons.Close size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 xl:grid-cols-[340px_1fr] overflow-hidden">
          <div className="border-r border-border p-4 overflow-y-auto space-y-2 scrollbar-thin">
            <div className="rounded-lg border border-border bg-secondary/20 p-3">
              <div className="text-xs text-muted-foreground mb-1">原文</div>
              <div className="text-xs text-foreground leading-6 whitespace-pre-wrap">
                {sourceText || '暂无文本'}
              </div>
            </div>
            {variants.map((variant, index) => (
              <button
                key={`variant-${index}`}
                onClick={() => setActiveIndex(index)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  activeIndex === index
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border bg-secondary/20 hover:bg-secondary/40'
                }`}
              >
                <div className="text-xs font-semibold text-foreground mb-1">版本 {index + 1}</div>
                <div className="text-[11px] text-muted-foreground line-clamp-4">{variant}</div>
              </button>
            ))}
            {variants.length === 0 && !isGenerating && (
              <div className="text-xs text-muted-foreground text-center py-8">
                点击“生成候选”开始
              </div>
            )}
          </div>

          <div className="p-4 overflow-y-auto space-y-3 scrollbar-thin">
            {error && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground mb-2">对比预览</div>
                <DiffViewer oldText={sourceText || ''} newText={activeVariant || ''} />
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border bg-card/70 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-border text-muted-foreground hover:text-foreground"
          >
            取消
          </button>
          <button
            onClick={() => onApplyVariant(activeVariant)}
            disabled={!activeVariant.trim()}
            className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            应用此版本
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
