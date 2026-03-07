import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Book, StoryNode } from '../types';
import { useToast } from '../hooks/useToast';
import { Icons } from './Icons';
import { initializeBuiltinPlugins, pluginRegistry } from '../plugins/registry';
import { PluginCategory, PluginRequirement } from '../plugins/types';

interface PluginCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBook: Book | null;
  currentNode: StoryNode | null;
  selectedText: string;
  onAfterRun?: () => void;
}

initializeBuiltinPlugins();

const categoryMeta: Record<PluginCategory, { label: string; description: string }> = {
  planning: { label: '规划', description: '沉淀事实、伏笔和场景元数据。' },
  writing: { label: '写作', description: '直接改造正文，补模板、提炼结构。' },
  review: { label: '审校', description: '做连贯性、可读性和风格修整。' },
};

const requirementLabel: Record<PluginRequirement, string> = {
  book: '需打开书籍',
  scene: '需场景节点',
  selection: '需选中文字',
};

export const PluginCenterModal: React.FC<PluginCenterModalProps> = ({
  isOpen,
  onClose,
  currentBook,
  currentNode,
  selectedText,
  onAfterRun,
}) => {
  const toast = useToast();
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const registryVersion = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getVersion,
    pluginRegistry.getVersion
  );

  const plugins = useMemo(() => pluginRegistry.listPlugins(), [registryVersion]);
  const groupedPlugins = useMemo(() => {
    const groups: Record<PluginCategory, typeof plugins> = {
      planning: [],
      writing: [],
      review: [],
    };
    plugins.forEach((plugin) => {
      groups[plugin.category || 'writing'].push(plugin);
    });
    return groups;
  }, [plugins]);

  if (!isOpen) return null;

  const meetsRequirements = (requirements: PluginRequirement[] | undefined) => {
    if (!requirements || requirements.length === 0) return true;
    return requirements.every((requirement) => {
      if (requirement === 'book') return Boolean(currentBook);
      if (requirement === 'scene') return currentNode?.type === 'scene';
      if (requirement === 'selection') return Boolean(selectedText.trim());
      return true;
    });
  };

  const runAction = async (actionKey: string) => {
    setRunningActionId(actionKey);
    try {
      const result = await pluginRegistry.executeAction(actionKey, {
        currentBook,
        currentNode,
        selectedText,
      });
      if (result && typeof result === 'object' && 'message' in result && result.message) {
        toast.success(result.message);
      } else {
        toast.success('插件动作执行完成');
      }
      onAfterRun?.();
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || '插件动作执行失败');
    } finally {
      setRunningActionId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[125] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[80vh] border border-border bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col ui-rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Puzzle size={18} className="text-primary" />
              插件中心
            </h3>
            <p className="text-xs text-muted-foreground mt-1">已注册 {plugins.length} 个插件，可执行扩展动作</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
          {(Object.keys(categoryMeta) as PluginCategory[]).map((category) => {
            const categoryPlugins = groupedPlugins[category];
            if (categoryPlugins.length === 0) return null;

            return (
              <section key={category} className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{categoryMeta[category].label}</h4>
                    <p className="text-[11px] text-muted-foreground mt-1">{categoryMeta[category].description}</p>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{categoryPlugins.length} 个插件</div>
                </div>

                {categoryPlugins.map((plugin) => (
                  <div key={plugin.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h5 className="text-sm font-semibold text-foreground">{plugin.name}</h5>
                        <div className="text-[11px] text-muted-foreground">{plugin.id} · v{plugin.version}</div>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{plugin.actions.length} actions</div>
                    </div>

                    {plugin.description && (
                      <div className="text-xs text-muted-foreground mb-3">{plugin.description}</div>
                    )}

                    <div className="space-y-2">
                      {plugin.actions.map((action) => {
                        const actionKey = `${plugin.id}:${action.id}`;
                        const isRunning = runningActionId === actionKey;
                        const available = meetsRequirements(action.requires);

                        return (
                          <div key={action.id} className="rounded-lg border border-border bg-background/40 px-3 py-2 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-foreground truncate">{action.title}</div>
                              {action.description && (
                                <div className="text-[11px] text-muted-foreground mt-0.5">{action.description}</div>
                              )}
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {(action.requires || []).map((requirement) => (
                                  <span key={`${action.id}-${requirement}`} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                                    {requirementLabel[requirement]}
                                  </span>
                                ))}
                                {action.contextHint && (
                                  <span className="text-[10px] text-muted-foreground">{action.contextHint}</span>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => { void runAction(actionKey); }}
                              disabled={isRunning || !available}
                              className="px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                              title={available ? '执行插件动作' : '当前上下文不满足执行条件'}
                            >
                              {isRunning ? '执行中...' : available ? '执行' : '条件不足'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
};
