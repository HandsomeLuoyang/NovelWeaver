import { metadataHelperPlugin } from './builtin/metadataHelperPlugin';
import { NovelWeaverPlugin, PluginAction, PluginRunContext, PluginRunResult } from './types';

class PluginRegistry {
  private plugins = new Map<string, NovelWeaverPlugin>();
  private actions = new Map<string, { pluginId: string; action: PluginAction }>();

  private removeActionsForPlugin(pluginId: string) {
    Array.from(this.actions.keys()).forEach((key) => {
      if (key.startsWith(`${pluginId}:`)) {
        this.actions.delete(key);
      }
    });
  }

  register(plugin: NovelWeaverPlugin) {
    // Replace old actions when plugin with same id is re-registered.
    this.removeActionsForPlugin(plugin.id);
    this.plugins.set(plugin.id, plugin);
    plugin.actions.forEach((action) => {
      const key = `${plugin.id}:${action.id}`;
      this.actions.set(key, { pluginId: plugin.id, action });
    });
  }

  unregister(pluginId: string) {
    this.plugins.delete(pluginId);
    this.removeActionsForPlugin(pluginId);
  }

  listPlugins() {
    return Array.from(this.plugins.values());
  }

  listActions() {
    return Array.from(this.actions.entries()).map(([id, value]) => ({
      id,
      pluginId: value.pluginId,
      action: value.action,
    }));
  }

  async executeAction(actionKey: string, context: PluginRunContext): Promise<PluginRunResult | void> {
    const actionRef = this.actions.get(actionKey);
    if (!actionRef) {
      throw new Error('插件动作不存在');
    }
    return actionRef.action.run(context);
  }
}

export const pluginRegistry = new PluginRegistry();

let initialized = false;
export const initializeBuiltinPlugins = () => {
  if (initialized) return;
  initialized = true;
  pluginRegistry.register(metadataHelperPlugin);
};
