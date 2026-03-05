import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../../src/components/ThemeToggle';
import { useStore } from '../../src/store';

const createMatchMedia = (matches: boolean) => (
  vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
);

describe('ThemeToggle', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMedia(false),
    });

    act(() => {
      useStore.setState({
        theme: 'light',
        lightThemeVariant: 'sunrise',
        darkThemeVariant: 'midnight',
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('updates light theme variant when clicking a light palette option', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /主题/ }));
    await user.click(screen.getByRole('button', { name: /羊皮纸/ }));

    expect(useStore.getState().lightThemeVariant).toBe('paper');
  });

  it('updates dark theme variant when clicking a dark palette option', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /主题/ }));
    await user.click(screen.getByRole('button', { name: /夜林/ }));

    expect(useStore.getState().darkThemeVariant).toBe('forest');
  });

  it('supports selecting newly added light theme variant', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /主题/ }));
    await user.click(screen.getByRole('button', { name: /云昼蓝雾/ }));

    expect(useStore.getState().lightThemeVariant).toBe('dawn');
  });

  it('supports selecting newly added dark theme variant', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: /主题/ }));
    await user.click(screen.getByRole('button', { name: /星云靛紫/ }));

    expect(useStore.getState().darkThemeVariant).toBe('nebula');
  });
});
