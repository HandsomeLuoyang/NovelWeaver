import { describe, expect, it } from 'vitest';
import { evaluatePublishWorkflow } from '../../services/publishWorkflowService';
import { createBook, createNode, longDraft } from '../helpers/fixtures';

describe('evaluatePublishWorkflow', () => {
  it('marks all stages as passed for release-ready content', () => {
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
        content: longDraft('scene one'),
        order: 0,
        meta: { pov: 'A', location: 'City', participants: ['A'] },
      }),
      createNode({
        id: 's2',
        parentId: 'c1',
        type: 'scene',
        title: 'S2',
        summary: 'Day 2',
        status: 'drafted',
        content: longDraft('scene two'),
        order: 1,
        meta: { pov: 'B', location: 'Port', conflictType: '对抗', participants: ['B'] },
      }),
    ];

    const report = evaluatePublishWorkflow(book, nodes);

    expect(report.qualityScore).toBe(100);
    expect(report.draftCoverage).toBe(1);
    expect(report.outlineCompleteness).toBe(1);
    expect(report.metadataCoverage).toBe(1);
    expect(report.findingsSummary.high).toBe(0);
    expect(report.stages.every((stage) => stage.passed)).toBe(true);
  });

  it('blocks release when high-severity issues and low coverage exist', () => {
    const book = createBook();
    const nodes = [
      createNode({ id: 'v1', type: 'volume', title: 'V1', order: 0 }),
      createNode({
        id: 's-root',
        parentId: null,
        type: 'scene',
        title: 'BadRootScene',
        summary: 'Day 1',
        status: 'drafted',
        content: 'too short',
        order: 1,
      }),
    ];

    const report = evaluatePublishWorkflow(book, nodes);
    const releaseStage = report.stages.find((stage) => stage.id === 'release');
    const reviewStage = report.stages.find((stage) => stage.id === 'review');

    expect(report.qualityScore).toBeLessThan(85);
    expect(report.findingsSummary.high).toBeGreaterThan(0);
    expect(report.draftCoverage).toBe(0);
    expect(report.outlineCompleteness).toBe(0);
    expect(reviewStage?.passed).toBe(false);
    expect(releaseStage?.passed).toBe(false);
    expect(releaseStage?.blockers.length).toBeGreaterThan(0);
    expect(releaseStage?.blockers.some((blocker) => typeof blocker.message === 'string' && blocker.message.length > 0)).toBe(true);
    expect(reviewStage?.blockers.some((blocker) => blocker.suggestion && blocker.suggestion.length > 0)).toBe(true);
  });

  it('provides actionable node blockers for outline and draft gates', () => {
    const book = createBook();
    const nodes = [
      createNode({ id: 'v1', type: 'volume', title: 'V1', order: 0 }),
      createNode({ id: 'a1', parentId: 'v1', type: 'arc', title: 'A1', order: 0 }),
      createNode({ id: 'c-empty', parentId: 'a1', type: 'chapter', title: 'C-Empty', order: 0 }),
      createNode({ id: 'c1', parentId: 'a1', type: 'chapter', title: 'C1', order: 1 }),
      createNode({
        id: 's1',
        parentId: 'c1',
        type: 'scene',
        title: 'S1',
        summary: 'Day 1',
        status: 'empty',
        content: '',
        order: 0,
      }),
    ];

    const report = evaluatePublishWorkflow(book, nodes);
    const outlineStage = report.stages.find((stage) => stage.id === 'outline');
    const draftStage = report.stages.find((stage) => stage.id === 'draft');

    expect(outlineStage?.passed).toBe(false);
    expect(outlineStage?.blockers[0]?.nodeId).toBe('c-empty');
    expect(outlineStage?.blockers[0]?.suggestion).toContain('建议优先补齐');

    expect(draftStage?.passed).toBe(false);
    expect(draftStage?.blockers[0]?.nodeId).toBe('s1');
    expect(draftStage?.blockers[0]?.suggestion).toContain('建议优先补写');
  });
});
