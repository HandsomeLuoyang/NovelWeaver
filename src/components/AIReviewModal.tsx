import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './Icons';

interface AIReviewModalProps {
  isOpen: boolean;
  mode: 'draft' | 'polish';
  generatedContent: string;
  onCancel: () => void;
  onApply: (acceptedContent: string) => void;
}

const splitSegments = (content: string) => {
  const normalized = content.trim();
  if (!normalized) return [];

  const segments = normalized
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [normalized];
};

export const AIReviewModal: React.FC<AIReviewModalProps> = ({
  isOpen,
  mode,
  generatedContent,
  onCancel,
  onApply,
}) => {
  const segments = useMemo(() => splitSegments(generatedContent), [generatedContent]);
  const [selected, setSelected] = useState<boolean[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setSelected(segments.map(() => true));
  }, [isOpen, segments]);

  if (!isOpen) return null;

  const acceptedContent = segments
    .filter((_, index) => selected[index])
    .join('\n\n');

  const toggleSegment = (index: number) => {
    setSelected((prev) => prev.map((checked, i) => (i === index ? !checked : checked)));
  };

  const selectAll = () => {
    setSelected(segments.map(() => true));
  };

  const deselectAll = () => {
    setSelected(segments.map(() => false));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-6xl h-[86vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Wand size={18} className="text-primary" />
              AI 结果分段采纳
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {mode === 'draft' ? '草稿生成已完成，请选择需要保留的段落。' : '润色已完成，请按段落选择采纳内容。'}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-border flex items-center gap-2 bg-background/40">
          <button
            onClick={selectAll}
            className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 text-foreground"
          >
            全选
          </button>
          <button
            onClick={deselectAll}
            className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
          >
            全不选
          </button>
          <span className="text-xs text-muted-foreground ml-2">
            已选择 {selected.filter(Boolean).length} / {segments.length} 段
          </span>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[360px_1fr] overflow-hidden">
          <div className="border-r border-border overflow-y-auto p-4 space-y-2 scrollbar-thin">
            {segments.map((segment, index) => (
              <button
                key={`${index}-${segment.slice(0, 10)}`}
                onClick={() => toggleSegment(index)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selected[index]
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-secondary/20 hover:bg-secondary/40'
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selected[index])}
                    onChange={() => toggleSegment(index)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">段落 {index + 1}</div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-3">{segment}</div>
                  </div>
                </div>
              </button>
            ))}

            {segments.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-10">暂无可采纳内容</div>
            )}
          </div>

          <div className="overflow-y-auto p-6 scrollbar-thin">
            <h4 className="text-sm font-semibold text-foreground mb-3">采纳预览</h4>
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground/90 bg-secondary/20 border border-border rounded-xl p-4 min-h-[240px]">
              {acceptedContent || '未选择任何段落'}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border bg-card/70 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md bg-secondary text-muted-foreground hover:text-foreground"
          >
            放弃
          </button>
          <button
            onClick={() => onApply(acceptedContent)}
            disabled={!acceptedContent.trim()}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            应用采纳
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
