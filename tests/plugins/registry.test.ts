import { afterEach, describe, expect, it } from 'vitest';
import { pluginRegistry, initializeBuiltinPlugins } from '../../plugins/registry';
import { NovelWeaverPlugin } from '../../plugins/types';
import { createBook, createNode } from '../helpers/fixtures';

const pluginId = 'test.plugin';

const testPlugin: NovelWeaverPlugin = {
  id: pluginId,
  name: 'Test Plugin',
  version: '0.0.1',
  actions: [
    {
      id: 'echo',
      title: 'Echo',
      run: async ({ selectedText }) => ({ message: `echo:${selectedText}` }),
    },
  ],
};

afterEach(() => {
  pluginRegistry.unregister(pluginId);
});

describe('pluginRegistry', () => {
  it('registers plugin actions and executes them', async () => {
    pluginRegistry.register(testPlugin);

    const plugins = pluginRegistry.listPlugins();
    const actions = pluginRegistry.listActions();

    expect(plugins.some((plugin) => plugin.id === pluginId)).toBe(true);
    expect(actions.some((action) => action.id === `${pluginId}:echo`)).toBe(true);

    const result = await pluginRegistry.executeAction(`${pluginId}:echo`, {
      currentBook: createBook(),
      currentNode: createNode({ id: 's1', type: 'scene', title: 'S1' }),
      selectedText: 'hello',
    });

    expect(result).toBeDefined();
    if (!result) {
      throw new Error('Expected plugin action result');
    }
    expect(result.message).toBe('echo:hello');
  });

  it('removes actions after unregister', () => {
    pluginRegistry.register(testPlugin);
    pluginRegistry.unregister(pluginId);

    expect(pluginRegistry.listActions().some((action) => action.id.startsWith(`${pluginId}:`))).toBe(false);
  });

  it('re-registering same plugin id replaces stale actions', () => {
    pluginRegistry.register(testPlugin);

    const updatedPlugin: NovelWeaverPlugin = {
      ...testPlugin,
      actions: [
        {
          id: 'new-action',
          title: 'New Action',
          run: () => ({ message: 'ok' }),
        },
      ],
    };

    pluginRegistry.register(updatedPlugin);

    const actionIds = pluginRegistry
      .listActions()
      .filter((action) => action.pluginId === pluginId)
      .map((action) => action.id);

    expect(actionIds).toEqual([`${pluginId}:new-action`]);
  });

  it('throws when executing an unknown action', async () => {
    await expect(
      pluginRegistry.executeAction('unknown:action', {
        currentBook: null,
        currentNode: null,
        selectedText: '',
      }),
    ).rejects.toThrow('插件动作不存在');
  });

  it('initializes builtin plugins only once', () => {
    initializeBuiltinPlugins();
    const countAfterFirst = pluginRegistry.listPlugins().filter((plugin) => plugin.id === 'builtin.metadata-helper').length;

    initializeBuiltinPlugins();
    const countAfterSecond = pluginRegistry.listPlugins().filter((plugin) => plugin.id === 'builtin.metadata-helper').length;

    expect(countAfterFirst).toBe(1);
    expect(countAfterSecond).toBe(1);
  });
});
