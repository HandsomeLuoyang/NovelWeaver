import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginCenterModal } from '../../components/PluginCenterModal';
import { pluginRegistry } from '../../plugins/registry';
import { NovelWeaverPlugin } from '../../plugins/types';

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const dynamicPluginId = 'test.dynamic-plugin';

const dynamicPlugin: NovelWeaverPlugin = {
  id: dynamicPluginId,
  name: 'Dynamic Plugin',
  version: '0.0.1',
  actions: [
    {
      id: 'noop',
      title: 'Noop',
      run: () => ({ message: 'ok' }),
    },
  ],
};

afterEach(() => {
  cleanup();
  act(() => {
    pluginRegistry.unregister(dynamicPluginId);
  });
});

describe('PluginCenterModal', () => {
  it('updates plugin list when registry changes at runtime', async () => {
    const initialCount = pluginRegistry.listPlugins().length;

    render(
      <PluginCenterModal
        isOpen
        onClose={vi.fn()}
        currentBook={null}
        currentNode={null}
        selectedText=""
      />,
    );

    expect(screen.getByText(new RegExp(`已注册\\s*${initialCount}\\s*个插件`))).toBeInTheDocument();

    await act(async () => {
      pluginRegistry.register(dynamicPlugin);
    });

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`已注册\\s*${initialCount + 1}\\s*个插件`))).toBeInTheDocument();
    });
  });
});
