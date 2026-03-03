import { Book, NodeStatus, NodeType, StoryNode } from '../../types';

const now = 1_700_000_000_000;

export const createBook = (overrides: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Test Book',
  premise: 'Premise',
  worldSetting: 'World',
  characters: [],
  wordCount: 0,
  createdAt: now,
  ...overrides,
});

interface NodeOptions {
  id: string;
  bookId?: string;
  parentId?: string | null;
  type: NodeType;
  title: string;
  summary?: string;
  content?: string;
  status?: NodeStatus;
  order?: number;
  meta?: StoryNode['meta'];
}

export const createNode = ({
  id,
  bookId = 'book-1',
  parentId = null,
  type,
  title,
  summary = '',
  content,
  status = 'empty',
  order = 0,
  meta,
}: NodeOptions): StoryNode => ({
  id,
  bookId,
  parentId,
  type,
  title,
  summary,
  content,
  status,
  order,
  meta,
});

export const longDraft = (seed = 'Scene content'): string =>
  `${seed} `.repeat(12).trim();
