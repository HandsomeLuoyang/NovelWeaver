import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Book, StoryNode } from '../types';
import { useToast } from '../hooks/useToast';
import { Icons } from './Icons';
import { initializeBuiltinPlugins, pluginRegistry } from '../plugins/registry';

interface PluginCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBook: Book | null;
  currentNode: StoryNode | null;
  selectedText: string;
  onAfterRun?: () => void;
}

initializeBuiltinPlugins();

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

  const plugins = useMemo(() => pluginRegistry.listPlugins(), []);

  if (!isOpen) return null;

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
        className="w-full max-w-4xl h-[80vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Cpu size={18} className="text-primary" />
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{plugin.name}</h4>
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

                  return (
                    <div key={action.id} className="rounded-lg border border-border bg-background/40 px-3 py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{action.title}</div>
                        {action.description && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">{action.description}</div>
                        )}
                      </div>

                      <button
                        onClick={() => { void runAction(actionKey); }}
                        disabled={isRunning}
                        className="px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {isRunning ? '执行中...' : '执行'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
