import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { SceneTemplate } from '../types';
import { useStore } from '../store';
import { Icons } from './Icons';

interface SceneTemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTemplate: (template: SceneTemplate) => void;
}

const emptyTemplate = (): SceneTemplate => ({
  id: `template-${Date.now()}`,
  name: '',
  description: '',
  metaPreset: {
    pov: '',
    timeTag: '',
    location: '',
    participants: [],
    conflictType: '',
    tags: [],
    goal: '',
    obstacle: '',
    turn: '',
    outcome: '',
  },
  summaryPrompt: '',
  draftingPrompt: '',
  updatedAt: Date.now(),
});

export const SceneTemplateManagerModal: React.FC<SceneTemplateManagerModalProps> = ({ isOpen, onClose, onApplyTemplate }) => {
  const { sceneTemplates, upsertSceneTemplate, removeSceneTemplate } = useStore();
  const [draft, setDraft] = useState<SceneTemplate>(emptyTemplate());

  const templates = useMemo(() => sceneTemplates, [sceneTemplates]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!draft.name.trim()) return;
    upsertSceneTemplate({
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      summaryPrompt: draft.summaryPrompt.trim(),
      draftingPrompt: draft.draftingPrompt.trim(),
    });
    setDraft(emptyTemplate());
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-5xl h-[82vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden grid grid-cols-[1.2fr_0.9fr]" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col min-h-0">
          <div className="px-6 py-4 border-b border-border bg-card/80 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Icons.FileText size={18} className="text-primary" />
                场景模板系统
              </h3>
              <p className="text-xs text-muted-foreground mt-1">内置模板可直接套用，右侧可新增自定义模板。</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
              <Icons.Close size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {templates.map((template) => (
              <div key={template.id} className="rounded-2xl border border-border bg-secondary/15 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{template.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">{template.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onApplyTemplate(template)}
                      className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs"
                    >
                      应用
                    </button>
                    {!template.builtin && (
                      <button
                        onClick={() => removeSceneTemplate(template.id)}
                        className="px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground text-xs"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-[11px] text-muted-foreground">
                  <div>目标：{template.metaPreset.goal || '未设定'}</div>
                  <div>阻力：{template.metaPreset.obstacle || '未设定'}</div>
                  <div>转折：{template.metaPreset.turn || '未设定'}</div>
                  <div>结果：{template.metaPreset.outcome || '未设定'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-l border-border flex flex-col min-h-0">
          <div className="px-6 py-4 border-b border-border bg-card/80">
            <h4 className="text-sm font-semibold text-foreground">新增自定义模板</h4>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
            <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="模板名称" className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm" />
            <textarea value={draft.description} onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))} placeholder="模板描述" className="w-full h-20 rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm resize-none" />
            <input value={draft.metaPreset.goal || ''} onChange={(event) => setDraft((prev) => ({ ...prev, metaPreset: { ...prev.metaPreset, goal: event.target.value } }))} placeholder="场景目标" className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm" />
            <input value={draft.metaPreset.obstacle || ''} onChange={(event) => setDraft((prev) => ({ ...prev, metaPreset: { ...prev.metaPreset, obstacle: event.target.value } }))} placeholder="主要阻力" className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm" />
            <input value={draft.metaPreset.turn || ''} onChange={(event) => setDraft((prev) => ({ ...prev, metaPreset: { ...prev.metaPreset, turn: event.target.value } }))} placeholder="转折" className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm" />
            <input value={draft.metaPreset.outcome || ''} onChange={(event) => setDraft((prev) => ({ ...prev, metaPreset: { ...prev.metaPreset, outcome: event.target.value } }))} placeholder="结果" className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm" />
            <textarea value={draft.summaryPrompt} onChange={(event) => setDraft((prev) => ({ ...prev, summaryPrompt: event.target.value }))} placeholder="摘要提示" className="w-full h-24 rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm resize-none" />
            <textarea value={draft.draftingPrompt} onChange={(event) => setDraft((prev) => ({ ...prev, draftingPrompt: event.target.value }))} placeholder="起草提示" className="w-full h-24 rounded-xl border border-border bg-secondary/20 px-3 py-2 text-sm resize-none" />
          </div>
          <div className="p-4 border-t border-border">
            <button onClick={handleSave} className="w-full px-4 py-2 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 text-sm">
              保存模板
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
