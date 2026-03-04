import { describe, expect, it } from 'vitest';
import { createNode } from '../helpers/fixtures';
import { buildFactPromptContext, detectLockedFactConflicts, extractFactCandidatesFromNodes } from '../../services/factLibrary';
import { FactEntry } from '../../types';

const createFact = (overrides: Partial<FactEntry>): FactEntry => ({
  id: overrides.id || `fact-${Math.random()}`,
  bookId: overrides.bookId || 'book-1',
  category: overrides.category || 'custom',
  statement: overrides.statement || '林秋是霜港治安官',
  notes: overrides.notes || '',
  tags: overrides.tags || [],
  sourceNodeId: overrides.sourceNodeId,
  sourceExcerpt: overrides.sourceExcerpt,
  reliability: overrides.reliability || 'confirmed',
  locked: overrides.locked ?? true,
  status: overrides.status || 'active',
  createdAt: overrides.createdAt || Date.now(),
  updatedAt: overrides.updatedAt || Date.now(),
});

describe('factLibrary service', () => {
  it('builds prompt context with locked and soft facts', () => {
    const context = buildFactPromptContext([
      createFact({ statement: '林秋是霜港治安官', locked: true, category: 'character' }),
      createFact({ statement: '霜港位于北陆海岸', locked: false, category: 'location' }),
    ]);

    expect(context.activeCount).toBe(2);
    expect(context.lockedCount).toBe(1);
    expect(context.factHardConstraints).toContain('林秋是霜港治安官');
    expect(context.factSoftContext).toContain('霜港位于北陆海岸');
  });

  it('detects contradiction against locked facts', () => {
    const facts = [
      createFact({ id: 'f1', statement: '林秋是霜港治安官', locked: true, category: 'character' }),
    ];
    const conflicts = detectLockedFactConflicts(facts, '林秋并不是霜港治安官，他只是临时顾问。');

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].factId).toBe('f1');
  });

  it('extracts candidate facts from scene summary and content', () => {
    const nodes = [
      createNode({
        id: 's1',
        bookId: 'book-1',
        type: 'scene',
        title: 'S1',
        summary: '第3天，林秋是霜港治安官。',
        content: '霜港位于北陆海岸。城内规则是夜间禁止鸣枪。',
      }),
    ];

    const candidates = extractFactCandidatesFromNodes('book-1', nodes, [], []);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((candidate) => candidate.statement.includes('林秋'))).toBe(true);
  });
});
