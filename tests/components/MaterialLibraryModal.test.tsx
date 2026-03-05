import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialLibraryModal } from '../../src/components/MaterialLibraryModal';
import { createBook, createNode } from '../helpers/fixtures';
import { MaterialEntry, StoryNode } from '../../src/types';

const mocks = vi.hoisted(() => ({
  useLiveQuery: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: mocks.useLiveQuery,
}));

vi.mock('../../src/db', () => ({
  db: {
    materials: {
      put: mocks.put,
      delete: mocks.delete,
      where: () => ({
        equals: () => ({
          toArray: async () => [],
        }),
      }),
    },
    nodes: {
      where: () => ({
        equals: () => ({
          toArray: async () => [],
        }),
      }),
    },
  },
}));

vi.mock('../../src/hooks/useToast', () => ({
  useToast: () => mocks.toast,
}));

describe('MaterialLibraryModal', () => {
  const book = createBook({ id: 'book-material' });
  const nodes: StoryNode[] = [
    createNode({ id: 'n1', bookId: book.id, type: 'scene', title: '场景一', summary: 's1', order: 0 }),
  ];
  let materials: MaterialEntry[] = [];
  let callCount = 0;

  beforeEach(() => {
    callCount = 0;
    materials = [
      {
        id: 'm1',
        bookId: book.id,
        type: 'idea',
        title: '港口追逐',
        content: '暴雨夜在港口发生追逐。',
        tags: ['动作'],
        source: '灵感本',
        linkedNodeId: 'n1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'm2',
        bookId: book.id,
        type: 'note',
        title: '对白节奏',
        content: '短句交锋，避免赘述。',
        tags: ['对白'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    mocks.useLiveQuery.mockReset();
    mocks.useLiveQuery.mockImplementation(() => {
      callCount += 1;
      return callCount % 2 === 1 ? materials : nodes;
    });

    mocks.put.mockReset();
    mocks.delete.mockReset();
    mocks.toast.success.mockReset();
    mocks.toast.error.mockReset();
    mocks.toast.info.mockReset();
    mocks.toast.warning.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('filters materials by type', async () => {
    render(
      <MaterialLibraryModal
        isOpen
        onClose={vi.fn()}
        book={book}
        currentNode={nodes[0]}
      />,
    );

    expect(screen.getByText('港口追逐')).toBeInTheDocument();
    expect(screen.getByText('对白节奏')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创意' }));

    await waitFor(() => {
      expect(screen.getByText('港口追逐')).toBeInTheDocument();
      expect(screen.queryByText('对白节奏')).not.toBeInTheDocument();
    });
  });

  it('saves a new material entry', async () => {
    render(
      <MaterialLibraryModal
        isOpen
        onClose={vi.fn()}
        book={book}
        currentNode={nodes[0]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('例如：港口暴雨追逐场景'), {
      target: { value: '审讯室反转' },
    });
    fireEvent.change(screen.getByPlaceholderText('可粘贴片段、场景灵感、人物语气库、世界观参考、桥段拆解等。'), {
      target: { value: '主角在审讯室识破伪证。' },
    });

    fireEvent.click(screen.getByRole('button', { name: '保存素材' }));

    await waitFor(() => {
      expect(mocks.put).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.put.mock.calls[0]?.[0];
    expect(payload.title).toBe('审讯室反转');
    expect(payload.content).toBe('主角在审讯室识破伪证。');
    expect(payload.bookId).toBe(book.id);
    expect(mocks.toast.success).toHaveBeenCalled();
  });
});
