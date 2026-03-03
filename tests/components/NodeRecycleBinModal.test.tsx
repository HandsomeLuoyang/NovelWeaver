import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDeletedNodesForBook: vi.fn(),
  restoreNodeFromRecycleBin: vi.fn(),
  permanentlyDeleteNodeFromRecycleBin: vi.fn(),
  useToast: vi.fn(),
}));

vi.mock('../../db', () => ({
  getDeletedNodesForBook: mocks.getDeletedNodesForBook,
  restoreNodeFromRecycleBin: mocks.restoreNodeFromRecycleBin,
  permanentlyDeleteNodeFromRecycleBin: mocks.permanentlyDeleteNodeFromRecycleBin,
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: mocks.useToast,
}));

import { NodeRecycleBinModal } from '../../components/NodeRecycleBinModal';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.getDeletedNodesForBook.mockReset();
  mocks.restoreNodeFromRecycleBin.mockReset();
  mocks.permanentlyDeleteNodeFromRecycleBin.mockReset();
  mocks.useToast.mockReset();

  mocks.getDeletedNodesForBook.mockResolvedValue([]);
  mocks.useToast.mockImplementation(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }));
});

describe('NodeRecycleBinModal', () => {
  it('loads entries once per open cycle even when toast identity changes per render', async () => {
    const { rerender } = render(
      <NodeRecycleBinModal
        isOpen
        onClose={vi.fn()}
        bookId="book-1"
      />,
    );

    await waitFor(() => {
      expect(mocks.getDeletedNodesForBook).toHaveBeenCalledTimes(1);
    });
    expect(mocks.getDeletedNodesForBook).toHaveBeenLastCalledWith('book-1');

    rerender(
      <NodeRecycleBinModal
        isOpen
        onClose={() => {}}
        bookId="book-1"
      />,
    );

    await waitFor(() => {
      expect(mocks.getDeletedNodesForBook).toHaveBeenCalledTimes(1);
    });
  });

  it('restores an entry and notifies parent callback', async () => {
    const entry = {
      id: 'deleted-1',
      bookId: 'book-1',
      rootNodeId: 'node-root',
      rootNodeTitle: 'Node To Restore',
      rootParentId: null,
      deletedAt: Date.now(),
      data: { nodes: [], history: [], snapshots: [] },
    };

    mocks.getDeletedNodesForBook.mockResolvedValue([entry]);
    mocks.restoreNodeFromRecycleBin.mockResolvedValue('restored-node');
    const onRestored = vi.fn();

    render(
      <NodeRecycleBinModal
        isOpen
        onClose={vi.fn()}
        bookId="book-1"
        onRestored={onRestored}
      />,
    );

    await screen.findByText('Node To Restore');
    await userEvent.click(screen.getByRole('button', { name: '恢复' }));

    await waitFor(() => {
      expect(mocks.restoreNodeFromRecycleBin).toHaveBeenCalledWith('deleted-1');
      expect(onRestored).toHaveBeenCalledWith('restored-node');
    });
  });
});
