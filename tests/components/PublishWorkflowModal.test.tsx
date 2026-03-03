import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishWorkflowModal } from '../../components/PublishWorkflowModal';
import { createBook, createNode, longDraft } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  useLiveQuery: vi.fn(),
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: mocks.useLiveQuery,
}));

const book = createBook({ id: 'book-live' });

const weakNodes = [
  createNode({ id: 'v1', bookId: book.id, type: 'volume', title: 'V1', order: 0 }),
  createNode({
    id: 's-root',
    bookId: book.id,
    parentId: null,
    type: 'scene',
    title: 'BadRootScene',
    summary: 'Day 1',
    status: 'drafted',
    content: 'too short',
    order: 1,
  }),
];

const strongNodes = [
  createNode({ id: 'v1', bookId: book.id, type: 'volume', title: 'V1', order: 0 }),
  createNode({ id: 'a1', bookId: book.id, parentId: 'v1', type: 'arc', title: 'A1', order: 0 }),
  createNode({ id: 'c1', bookId: book.id, parentId: 'a1', type: 'chapter', title: 'C1', order: 0 }),
  createNode({
    id: 's1',
    bookId: book.id,
    parentId: 'c1',
    type: 'scene',
    title: 'S1',
    summary: 'Day 1',
    status: 'drafted',
    content: longDraft('scene one'),
    order: 0,
    meta: { pov: 'A', location: 'City', participants: ['A'] },
  }),
  createNode({
    id: 's2',
    bookId: book.id,
    parentId: 'c1',
    type: 'scene',
    title: 'S2',
    summary: 'Day 2',
    status: 'drafted',
    content: longDraft('scene two'),
    order: 1,
    meta: { pov: 'B', conflictType: '对抗', participants: ['B'] },
  }),
];

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.useLiveQuery.mockReset();
});

describe('PublishWorkflowModal', () => {
  it('recomputes report when live query nodes update', async () => {
    let liveNodes = weakNodes;
    mocks.useLiveQuery.mockImplementation(() => liveNodes);

    const { rerender } = render(
      <PublishWorkflowModal
        isOpen
        onClose={vi.fn()}
        book={book}
      />,
    );

    expect(screen.queryAllByText('通过')).toHaveLength(0);

    liveNodes = strongNodes;
    rerender(
      <PublishWorkflowModal
        isOpen
        onClose={vi.fn()}
        book={book}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('通过')).toHaveLength(4);
    });
  });
});
