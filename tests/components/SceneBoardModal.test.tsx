import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  equals: vi.fn(),
  toArray: vi.fn(),
  useToast: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      where: mocks.where,
    },
  },
  createAutoSnapshotForParent: vi.fn(),
}));

vi.mock('../../src/hooks/useToast', () => ({
  useToast: mocks.useToast,
}));

import { SceneBoardModal } from '../../src/components/SceneBoardModal';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.where.mockReset();
  mocks.equals.mockReset();
  mocks.toArray.mockReset();
  mocks.useToast.mockReset();

  mocks.toArray.mockResolvedValue([]);
  mocks.equals.mockImplementation(() => ({ toArray: mocks.toArray }));
  mocks.where.mockImplementation(() => ({ equals: mocks.equals }));
  mocks.useToast.mockImplementation(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }));
});

describe('SceneBoardModal', () => {
  it('loads board data once per open cycle even if toast identity changes', async () => {
    const { rerender } = render(
      <SceneBoardModal
        isOpen
        onClose={vi.fn()}
        bookId="book-1"
      />,
    );

    await waitFor(() => {
      expect(mocks.where).toHaveBeenCalledTimes(1);
    });
    expect(mocks.where).toHaveBeenLastCalledWith('bookId');
    expect(mocks.equals).toHaveBeenLastCalledWith('book-1');

    rerender(
      <SceneBoardModal
        isOpen
        onClose={() => {}}
        bookId="book-1"
      />,
    );

    await waitFor(() => {
      expect(mocks.where).toHaveBeenCalledTimes(1);
    });
  });
});
