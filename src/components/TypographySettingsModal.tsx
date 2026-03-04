import React from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { Icons } from './Icons';
import { FONT_OPTIONS } from '../services/typography';

interface TypographySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const parseNumber = (value: string, fallback: number) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export const TypographySettingsModal: React.FC<TypographySettingsModalProps> = ({ isOpen, onClose }) => {
  const { editorTypography, updateEditorTypography, resetEditorTypography } = useStore();

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[128] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[84vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Layout size={18} className="text-primary" />
              排版设置
            </h3>
            <p className="text-xs text-muted-foreground mt-1">字体、字号、字距、行距、段距与版心宽度</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[460px_1fr] overflow-hidden">
          <div className="border-r border-border overflow-y-auto p-5 space-y-5 scrollbar-thin">
            <div>
              <label className="text-xs text-muted-foreground block mb-2">字体</label>
              <select
                value={editorTypography.fontFamily}
                onChange={(e) => updateEditorTypography({ fontFamily: e.target.value })}
                className="w-full bg-input border border-border rounded p-2.5 text-sm focus:outline-none focus:border-primary text-foreground"
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">字号</label>
                <span className="text-xs text-primary font-mono">{editorTypography.fontSize.toFixed(1)} px</span>
              </div>
              <input
                type="range"
                min={12}
                max={40}
                step={0.5}
                value={editorTypography.fontSize}
                onChange={(e) => updateEditorTypography({ fontSize: parseNumber(e.target.value, editorTypography.fontSize) })}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">字间距</label>
                <span className="text-xs text-primary font-mono">{editorTypography.letterSpacing.toFixed(2)} px</span>
              </div>
              <input
                type="range"
                min={-1}
                max={6}
                step={0.1}
                value={editorTypography.letterSpacing}
                onChange={(e) => updateEditorTypography({ letterSpacing: parseNumber(e.target.value, editorTypography.letterSpacing) })}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">行距</label>
                <span className="text-xs text-primary font-mono">{editorTypography.lineHeight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={1.2}
                max={2.8}
                step={0.05}
                value={editorTypography.lineHeight}
                onChange={(e) => updateEditorTypography({ lineHeight: parseNumber(e.target.value, editorTypography.lineHeight) })}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">段距</label>
                <span className="text-xs text-primary font-mono">{editorTypography.paragraphSpacing.toFixed(2)} em</span>
              </div>
              <input
                type="range"
                min={0.4}
                max={3}
                step={0.05}
                value={editorTypography.paragraphSpacing}
                onChange={(e) => updateEditorTypography({ paragraphSpacing: parseNumber(e.target.value, editorTypography.paragraphSpacing) })}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">排版宽度</label>
                <span className="text-xs text-primary font-mono">{editorTypography.contentWidth}px</span>
              </div>
              <input
                type="range"
                min={560}
                max={1600}
                step={20}
                value={editorTypography.contentWidth}
                onChange={(e) => updateEditorTypography({ contentWidth: parseNumber(e.target.value, editorTypography.contentWidth) })}
                className="w-full"
              />
            </div>
          </div>

          <div className="p-6 overflow-y-auto scrollbar-thin">
            <h4 className="text-sm font-semibold text-foreground mb-3">排版预览</h4>
            <div
              className="mx-auto border border-border bg-secondary/20 rounded-xl p-6 text-foreground/90 whitespace-pre-wrap"
              style={{
                maxWidth: `${editorTypography.contentWidth}px`,
                fontFamily: editorTypography.fontFamily,
                fontSize: `${editorTypography.fontSize}px`,
                letterSpacing: `${editorTypography.letterSpacing}px`,
                lineHeight: editorTypography.lineHeight,
              }}
            >
              第一段：雾气在街灯下缓慢流动，像一封尚未拆开的旧信。她停在巷口，听见远处传来短促的脚步声。
              {'\n\n'}
              第二段：他没有回头，只把围巾往上提了提。风从屋檐穿过，带起纸页的边角，像在催促某个答案尽快落地。
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border bg-card/70 flex items-center justify-between">
          <button
            onClick={resetEditorTypography}
            className="px-4 py-2 text-sm rounded-md bg-secondary text-muted-foreground hover:text-foreground"
          >
            恢复默认
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
