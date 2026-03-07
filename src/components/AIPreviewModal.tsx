import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './Icons';

export interface AIPreviewToggleState {
  includeHierarchyContext: boolean;
  includeLinearContext: boolean;
  includeSemanticContext: boolean;
  includeFactContext: boolean;
  includeMaterialContext: boolean;
  includeStyleBible: boolean;
}

export interface AIPreviewSection {
  key: keyof AIPreviewToggleState;
  title: string;
  description: string;
  content: string;
}

interface AIPreviewModalProps {
  isOpen: boolean;
  title: string;
  subtitle: string;
  targetLabel: string;
  scopeLabel: string;
  modelLabel: string;
  promptProfileLabel: string;
  sections: AIPreviewSection[];
  initialToggles: AIPreviewToggleState;
  onClose: () => void;
  onConfirm: (toggles: AIPreviewToggleState) => void;
}

export const AIPreviewModal: React.FC<AIPreviewModalProps> = ({
  isOpen,
  title,
  subtitle,
  targetLabel,
  scopeLabel,
  modelLabel,
  promptProfileLabel,
  sections,
  initialToggles,
  onClose,
  onConfirm,
}) => {
  const [toggles, setToggles] = useState<AIPreviewToggleState>(initialToggles);

  useEffect(() => {
    if (!isOpen) return;
    setToggles(initialToggles);
  }, [initialToggles, isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[82vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col ui-rise-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/80">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Icons.Sparkles size={18} className="text-primary" />
                {title}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
              <Icons.Close size={18} />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 border-b border-border bg-background/50 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
            <div className="text-muted-foreground">目标节点</div>
            <div className="mt-1 text-foreground font-medium">{targetLabel}</div>
          </div>
          <div className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
            <div className="text-muted-foreground">执行范围</div>
            <div className="mt-1 text-foreground font-medium">{scopeLabel}</div>
          </div>
          <div className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
            <div className="text-muted-foreground">模型</div>
            <div className="mt-1 text-foreground font-medium">{modelLabel}</div>
          </div>
          <div className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
            <div className="text-muted-foreground">提示词方案</div>
            <div className="mt-1 text-foreground font-medium">{promptProfileLabel}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin">
          {sections.map((section) => (
            <div key={section.key} className="rounded-2xl border border-border bg-secondary/15 overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{section.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{section.description}</div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={toggles[section.key]}
                    onChange={(event) => setToggles((prev) => ({ ...prev, [section.key]: event.target.checked }))}
                    className="accent-primary"
                  />
                  启用
                </label>
              </div>
              <div className="px-4 py-3">
                <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-foreground/85 font-sans">
                  {section.content || '（当前无可用内容）'}
                </pre>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border bg-card/80 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">确认后将按当前勾选内容执行生成。</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50">
              取消
            </button>
            <button onClick={() => onConfirm(toggles)} className="px-4 py-2 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20">
              确认执行
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
