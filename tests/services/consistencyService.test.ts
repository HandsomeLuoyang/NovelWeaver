import { describe, expect, it } from 'vitest';
import { runConsistencyCheck } from '../../src/services/consistencyService';
import { createBook, createNode, longDraft } from '../helpers/fixtures';

describe('runConsistencyCheck', () => {
  it('returns no findings for a coherent minimal outline', () => {
    const book = createBook();
    const nodes = [
      createNode({ id: 'v1', type: 'volume', title: 'V1', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: 'A1', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: 'C1', order: 0 }),
      createNode({
        id: 's1',
        parentId: 'c1',
        type: 'scene',
        title: 'S1',
        summary: 'Day 1',
        status: 'drafted',
        content: longDraft('coherent'),
        order: 0,
        meta: {
          goal: '找到失踪线索',
          obstacle: '线人临时失联',
          turn: '发现线人被假情报引开',
          outcome: '主角锁定新的调查方向',
        },
      }),
    ];

    const findings = runConsistencyCheck(book, nodes);
    expect(findings).toEqual([]);
  });

  it('detects structural, timeline and character consistency issues', () => {
    const book = createBook({
      characters: [
        { name: 'Alice', role: 'hero', description: '', secret: 'hidden code 123' },
        { name: 'Bob', role: 'ally', description: '', secret: '' },
        { name: 'Carol', role: 'ally', description: '', secret: '' },
      ],
    });

    const nodes = [
      createNode({ id: 'v1', type: 'volume', title: 'V1', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: 'Arc', order: 0 }),
      createNode({ id: 'a2', parentId: 'v1', type: 'arc', title: 'Arc', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: 'C1', order: 0 }),
      createNode({
        id: 's1',
        parentId: 'c1',
        type: 'scene',
        title: 'S1',
        summary: '第2天',
        status: 'drafted',
        content: 'hidden code 123',
        order: 0,
      }),
      createNode({
        id: 's2',
        parentId: 'c1',
        type: 'scene',
        title: 'S2',
        summary: '第1天',
        status: 'outlined',
        content: 'Carol enters the room.',
        order: 1,
      }),
      createNode({ id: 'wrong-child', parentId: 'v1', type: 'chapter', title: 'Wrong', order: 2 }),
      createNode({ id: 'orphan', parentId: 'missing', type: 'scene', title: 'Orphan', order: 0 }),
      createNode({ id: 'root-chapter', parentId: null, type: 'chapter', title: 'BadRoot', order: 10 }),
    ];

    const findings = runConsistencyCheck(book, nodes);
    const hasPrefix = (prefix: string) => findings.some((finding) => finding.id.startsWith(prefix));

    expect(hasPrefix('orphan-')).toBe(true);
    expect(hasPrefix('root-type-')).toBe(true);
    expect(hasPrefix('type-chain-')).toBe(true);
    expect(hasPrefix('dup-title-')).toBe(true);
    expect(hasPrefix('dup-order-')).toBe(true);
    expect(hasPrefix('empty-struct-')).toBe(true);
    expect(hasPrefix('draft-empty-')).toBe(true);
    expect(hasPrefix('timeline-regression-')).toBe(true);
    expect(hasPrefix('char-missing-')).toBe(true);
    expect(hasPrefix('char-weak-')).toBe(true);
    expect(hasPrefix('secret-leak-')).toBe(true);
  });

  it('detects character state-machine conflicts and outline-content drift', () => {
    const book = createBook({
      characters: [
        { name: 'Alice', role: 'hero', description: '', secret: '' },
      ],
    });

    const nodes = [
      createNode({ id: 'v1', type: 'volume', title: 'V1', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: 'A1', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: 'C1', order: 0 }),
      createNode({
        id: 's1',
        parentId: 'c1',
        type: 'scene',
        title: 'S1',
        summary: '第1天 Alice 身亡',
        status: 'drafted',
        content: 'Alice 死亡。尸体被带走。'.repeat(20),
        order: 0,
        meta: {
          participants: ['Alice'],
          location: '旧城区',
          timeTag: '第1天',
        },
      }),
      createNode({
        id: 's2',
        parentId: 'c1',
        type: 'scene',
        title: 'S2',
        summary: '第1天 海底议会就税制改革展开辩论，城市风平浪静',
        status: 'drafted',
        content: 'Alice 苏醒后开始追逐嫌犯。'.repeat(30),
        order: 1,
        meta: {
          participants: ['Alice'],
          location: '中央广场',
          timeTag: '第1天',
        },
      }),
    ];

    const findings = runConsistencyCheck(book, nodes);
    const hasPrefix = (prefix: string) => findings.some((finding) => finding.id.startsWith(prefix));

    expect(hasPrefix('char-state-resurrection-')).toBe(true);
    expect(hasPrefix('char-location-conflict-')).toBe(true);
    expect(hasPrefix('outline-drift-')).toBe(true);
  });

  it('detects conflicts against locked facts', () => {
    const book = createBook();
    const nodes = [
      createNode({ id: 'v1', type: 'volume', title: 'V1', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: 'A1', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: 'C1', order: 0 }),
      createNode({
        id: 's1',
        parentId: 'c1',
        type: 'scene',
        title: 'S1',
        summary: '人物冲突',
        status: 'drafted',
        content: '林秋并不是霜港治安官，他只是普通水手。'.repeat(10),
        order: 0,
      }),
    ];

    const findings = runConsistencyCheck(book, nodes, [{
      id: 'f1',
      bookId: book.id,
      category: 'character',
      statement: '林秋是霜港治安官',
      notes: '',
      tags: [],
      reliability: 'confirmed',
      locked: true,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);

    expect(findings.some((finding) => finding.id.startsWith('locked-fact-conflict-'))).toBe(true);
  });
});
