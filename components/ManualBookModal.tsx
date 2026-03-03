import React, { useEffect, useState } from 'react';
import { Character } from '../types';
import { Icons } from './Icons';
import { CharacterList } from './WorldBible/CharacterList';

export interface ManualBookPayload {
  title: string;
  premise: string;
  worldSetting: string;
  characters: Character[];
  initialVolumeTitle: string;
  initialVolumeSummary: string;
}

interface Props {
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (payload: ManualBookPayload) => Promise<void>;
}

const DEFAULT_VOLUME_TITLE = '第一卷';

export const ManualBookModal: React.FC<Props> = ({
  isOpen,
  isSubmitting,
  onClose,
  onConfirm
}) => {
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [worldSetting, setWorldSetting] = useState('');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [initialVolumeTitle, setInitialVolumeTitle] = useState(DEFAULT_VOLUME_TITLE);
  const [initialVolumeSummary, setInitialVolumeSummary] = useState('');
  const [activeTab, setActiveTab] = useState<'basic' | 'world' | 'chars'>('basic');

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setPremise('');
    setWorldSetting('');
    setCharacters([]);
    setInitialVolumeTitle(DEFAULT_VOLUME_TITLE);
    setInitialVolumeSummary('');
    setActiveTab('basic');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const canSubmit = title.trim().length > 0 && !isSubmitting;

  const handleConfirm = async () => {
    if (!canSubmit) return;

    await onConfirm({
      title: title.trim(),
      premise: premise.trim(),
      worldSetting: worldSetting.trim(),
      characters,
      initialVolumeTitle: initialVolumeTitle.trim() || DEFAULT_VOLUME_TITLE,
      initialVolumeSummary: initialVolumeSummary.trim()
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center">
              <Icons.Plus size={16} className="mr-2 text-primary" />
              手动添加作品
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              保存后会自动创建一个初始卷，便于立即开始大纲编排。
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="关闭"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex border-b border-border bg-secondary/30">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'basic' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.FileText size={16} className="mr-2" />
            基础信息
            {activeTab === 'basic' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('world')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'world' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.BookOpen size={16} className="mr-2" />
            世界观设定
            {activeTab === 'world' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('chars')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'chars' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.Users size={16} className="mr-2" />
            角色档案
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-secondary border border-border rounded-full text-muted-foreground">
              {characters.length}
            </span>
            {activeTab === 'chars' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-background/50">
          {activeTab === 'basic' && (
            <div className="max-w-3xl mx-auto space-y-5 animate-in slide-in-from-left-4 fade-in duration-200">
              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">书名 *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg p-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-lg font-bold"
                  placeholder="例如：雾海归航"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">核心梗概</label>
                <textarea
                  value={premise}
                  onChange={(e) => setPremise(e.target.value)}
                  className="w-full h-44 bg-input border border-border rounded-lg p-3 text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-none"
                  placeholder="一句话或几段话概括故事核心冲突..."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">初始卷标题</label>
                  <input
                    value={initialVolumeTitle}
                    onChange={(e) => setInitialVolumeTitle(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg p-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={DEFAULT_VOLUME_TITLE}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">初始卷摘要</label>
                  <input
                    value={initialVolumeSummary}
                    onChange={(e) => setInitialVolumeSummary(e.target.value)}
                    className="w-full bg-input border border-border rounded-lg p-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="可留空，默认继承核心梗概"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'world' && (
            <div className="h-full flex flex-col animate-in slide-in-from-right-4 fade-in duration-200">
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">世界观规则 / 设定集</label>
              <textarea
                value={worldSetting}
                onChange={(e) => setWorldSetting(e.target.value)}
                placeholder="在此输入世界背景、规则、力量体系、组织关系等..."
                className="flex-1 bg-input border border-border rounded-lg p-4 text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed font-serif resize-none"
              />
            </div>
          )}

          {activeTab === 'chars' && (
            <div className="h-full animate-in slide-in-from-bottom-4 fade-in duration-200">
              <CharacterList characters={characters} onChange={setCharacters} />
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-card/50 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 py-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors text-sm font-medium disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="px-6 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex items-center text-sm shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Icons.Loader2 className="w-4 h-4 mr-2 animate-spin" />
                创建中...
              </>
            ) : (
              <>
                <Icons.Check className="w-4 h-4 mr-2" />
                创建作品
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
