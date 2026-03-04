import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { PromptProfile, PromptTaskType } from '../types';
import {
  normalizePromptProfile,
  PROMPT_TASK_LABEL,
  PROMPT_TASKS,
  validatePromptTemplate,
} from '../services/promptProfiles';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const VARIABLE_HINTS: Record<PromptTaskType, string[]> = {
  genesis: ['{{controls}}', '{{userPrompt}}'],
  expansion: ['{{bookTitle}}', '{{parentTitle}}', '{{childTypeName}}', '{{controls}}'],
  drafting: ['{{hierarchyContext}}', '{{linearContext}}', '{{semanticContext}}', '{{draftLengthHint}}'],
  polishing: ['{{selection}}', '{{contextSnippet}}', '{{worldSettingSnippet}}', '{{polishRangeHint}}'],
  chat: ['{{chatContext}}', '{{dialogue}}', '{{controls}}'],
};

const cloneProfileForEdit = (profile: PromptProfile): PromptProfile => ({
  ...profile,
  templates: PROMPT_TASKS.reduce((acc, task) => {
    acc[task] = {
      systemPrompt: profile.templates[task].systemPrompt,
      userPrompt: profile.templates[task].userPrompt,
    };
    return acc;
  }, {} as PromptProfile['templates']),
});

const normalizeImportedProfiles = (raw: unknown): PromptProfile[] => {
  const payload = raw as any;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.profiles)
      ? payload.profiles
      : payload && typeof payload === 'object'
        ? [payload]
        : [];

  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizePromptProfile({
      id: String(item.id || `${Date.now()}-${Math.random()}`),
      name: String(item.name || '导入方案'),
      createdAt: Number(item.createdAt || Date.now()),
      updatedAt: Number(item.updatedAt || Date.now()),
      isBuiltin: false,
      templates: item.templates,
    }));
};

export const PromptManagerModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const {
    promptProfiles,
    activePromptProfileId,
    promptProfileRevisions,
    createPromptProfile,
    duplicatePromptProfile,
    savePromptProfile,
    deletePromptProfile,
    setActivePromptProfile,
    importPromptProfiles,
    rollbackPromptProfile,
  } = useStore();
  const toast = useToast();

  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [activeTask, setActiveTask] = useState<PromptTaskType>('genesis');
  const [draftProfile, setDraftProfile] = useState<PromptProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedProfile = useMemo(
    () => promptProfiles.find((profile) => profile.id === selectedProfileId) || promptProfiles[0],
    [promptProfiles, selectedProfileId]
  );

  const selectedRevisions = useMemo(
    () => promptProfileRevisions[selectedProfileId] || [],
    [promptProfileRevisions, selectedProfileId]
  );

  useEffect(() => {
    if (!isOpen) return;

    setSelectedProfileId((prev) => {
      if (prev && promptProfiles.some((profile) => profile.id === prev)) return prev;
      if (promptProfiles.some((profile) => profile.id === activePromptProfileId)) return activePromptProfileId;
      return promptProfiles[0]?.id || '';
    });
  }, [isOpen, promptProfiles, activePromptProfileId]);

  useEffect(() => {
    if (!isOpen || !selectedProfileId) return;
    const profile = promptProfiles.find((item) => item.id === selectedProfileId);
    if (!profile) return;

    setDraftProfile(cloneProfileForEdit(profile));
    setDirty(false);
  }, [isOpen, selectedProfileId, promptProfiles]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (dirty && !window.confirm('当前提示词有未保存修改，确定关闭吗？')) return;
    onClose();
  };

  const handleSelectProfile = (profileId: string) => {
    if (profileId === selectedProfileId) return;
    if (dirty && !window.confirm('当前提示词有未保存修改，切换将丢失，是否继续？')) return;
    setSelectedProfileId(profileId);
  };

  const handleCreateProfile = () => {
    const id = createPromptProfile('新提示词方案', selectedProfileId || activePromptProfileId);
    if (id) {
      setSelectedProfileId(id);
      setActiveTask('genesis');
    }
  };

  const handleDuplicateProfile = () => {
    if (!selectedProfileId) return;
    const id = duplicatePromptProfile(selectedProfileId);
    if (id) {
      setSelectedProfileId(id);
      setActiveTask('genesis');
    }
  };

  const handleDeleteProfile = () => {
    if (!selectedProfile) return;
    if (selectedProfile.isBuiltin) return;
    if (!window.confirm(`确定删除提示词方案「${selectedProfile.name}」吗？`)) return;

    deletePromptProfile(selectedProfile.id);
    setDirty(false);
  };

  const handleSave = () => {
    if (!draftProfile) return;
    savePromptProfile(normalizePromptProfile(draftProfile));
    setDirty(false);
  };

  const handleApply = () => {
    if (!selectedProfile) return;
    if (dirty && draftProfile?.id === selectedProfile.id) {
      handleSave();
    }
    setActivePromptProfile(selectedProfile.id);
  };

  const handleQuickApply = (profileId: string) => {
    if (dirty && draftProfile?.id === profileId) {
      handleSave();
    }
    setActivePromptProfile(profileId);
  };

  const handleExport = () => {
    if (!selectedProfile) return;
    const payload = JSON.stringify({ profiles: [selectedProfile] }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-profile-${selectedProfile.name.replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const profiles = normalizeImportedProfiles(parsed);
      if (profiles.length === 0) {
        toast.error('导入失败：未识别到可用提示词方案');
        return;
      }

      const importedIds = importPromptProfiles(profiles, { activateFirst: true });
      if (importedIds[0]) {
        setSelectedProfileId(importedIds[0]);
      }
      toast.success(`已导入 ${profiles.length} 份提示词方案`);
    } catch (error) {
      console.error(error);
      toast.error('导入失败：文件格式错误');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRollback = (revisionId: string) => {
    if (!selectedProfileId) return;
    if (!window.confirm('恢复该历史版本会覆盖当前方案，是否继续？')) return;

    rollbackPromptProfile(selectedProfileId, revisionId);
    setDirty(false);
    toast.success('已恢复到历史版本');
  };

  const updateDraftName = (name: string) => {
    if (!draftProfile) return;
    setDraftProfile({ ...draftProfile, name });
    setDirty(true);
  };

  const updateDraftTemplate = (task: PromptTaskType, field: 'systemPrompt' | 'userPrompt', value: string) => {
    if (!draftProfile) return;
    setDraftProfile({
      ...draftProfile,
      templates: {
        ...draftProfile.templates,
        [task]: {
          ...draftProfile.templates[task],
          [field]: value,
        },
      },
    });
    setDirty(true);
  };

  const currentTemplate = draftProfile?.templates[activeTask];
  const missingVariables = currentTemplate
    ? validatePromptTemplate(activeTask, currentTemplate)
    : [];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={handleClose}>
      <div
        className="bg-card border border-border w-full max-w-6xl h-[88vh] rounded-2xl shadow-2xl flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="w-80 border-r border-border bg-secondary/20 flex flex-col">
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <div className="px-4 py-4 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Icons.FileText size={16} className="text-primary" />
              提示词管理
            </h2>
            <button onClick={handleClose} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
              <Icons.Close size={16} />
            </button>
          </div>

          <div className="p-3 border-b border-border space-y-2">
            <button
              onClick={handleCreateProfile}
              className="w-full py-2 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              新建方案
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDuplicateProfile}
                disabled={!selectedProfile}
                className="py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
              >
                复制
              </button>
              <button
                onClick={handleDeleteProfile}
                disabled={!selectedProfile || selectedProfile.isBuiltin}
                className="py-2 text-xs rounded border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40"
              >
                删除
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleImportClick}
                className="py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                导入
              </button>
              <button
                onClick={handleExport}
                disabled={!selectedProfile}
                className="py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
              >
                导出
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin">
            {promptProfiles.map((profile) => {
              const isSelected = selectedProfile?.id === profile.id;
              const isActive = activePromptProfileId === profile.id;
              return (
                <div
                  key={profile.id}
                  className={`border rounded-lg p-2.5 transition-colors ${isSelected ? 'border-primary bg-primary/10' : 'border-border hover:border-border/80 bg-background/60'}`}
                >
                  <button
                    onClick={() => handleSelectProfile(profile.id)}
                    className="w-full text-left"
                  >
                    <div className="text-sm text-foreground font-medium truncate">{profile.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      {profile.isBuiltin && <span className="px-1.5 py-0.5 rounded bg-secondary">内置</span>}
                      {isActive && <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary">已应用</span>}
                    </div>
                  </button>
                  <button
                    onClick={() => handleQuickApply(profile.id)}
                    className="mt-2 w-full py-1.5 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  >
                    一键应用
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-card/50 flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <label className="text-xs text-muted-foreground block mb-1">方案名称</label>
              <input
                value={draftProfile?.name || ''}
                onChange={(e) => updateDraftName(e.target.value)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                placeholder="请输入提示词方案名称"
              />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <button
                onClick={handleApply}
                disabled={!selectedProfile}
                className="px-3 py-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
              >
                应用当前方案
              </button>
              <button
                onClick={handleSave}
                disabled={!dirty || !draftProfile}
                className="px-3 py-2 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                保存修改
              </button>
            </div>
          </div>

          <div className="px-5 pt-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {PROMPT_TASKS.map((task) => (
                <button
                  key={task}
                  onClick={() => setActiveTask(task)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors whitespace-nowrap ${activeTask === task ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
                >
                  {PROMPT_TASK_LABEL[task]}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground mb-2">
              可用变量：{VARIABLE_HINTS[activeTask].join('  ')}
            </div>
            {missingVariables.length > 0 && (
              <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                缺少关键变量：{missingVariables.map((item) => `{{${item}}}`).join('、')}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4 scrollbar-thin">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">System Prompt</label>
              <textarea
                value={currentTemplate?.systemPrompt || ''}
                onChange={(e) => updateDraftTemplate(activeTask, 'systemPrompt', e.target.value)}
                className="w-full min-h-[180px] bg-input border border-border rounded p-3 text-sm leading-6 focus:outline-none focus:border-primary resize-y"
                spellCheck={false}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground block mb-1">User Prompt</label>
              <textarea
                value={currentTemplate?.userPrompt || ''}
                onChange={(e) => updateDraftTemplate(activeTask, 'userPrompt', e.target.value)}
                className="w-full min-h-[280px] bg-input border border-border rounded p-3 text-sm leading-6 focus:outline-none focus:border-primary resize-y"
                spellCheck={false}
              />
            </div>

            {selectedRevisions.length > 0 && (
              <div className="border border-border rounded-lg p-3 bg-secondary/20">
                <div className="text-xs font-semibold text-foreground mb-2">历史版本（最近 {selectedRevisions.length} 条）</div>
                <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin">
                  {selectedRevisions.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-[11px] border border-border rounded px-2 py-1.5 bg-background/40">
                      <span className="text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                      <button
                        onClick={() => handleRollback(item.id)}
                        className="px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
