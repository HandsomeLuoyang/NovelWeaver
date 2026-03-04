import { describe, expect, it } from 'vitest';
import { createNode } from '../helpers/fixtures';
import { moveSceneInColumns, moveScenesInColumns } from '../../services/sceneBoard';

describe('moveSceneInColumns', () => {
  it('supports precise same-column insertion (not forced to bottom)', () => {
    const columns = [
      {
        chapterId: 'c1',
        chapterTitle: 'Chapter 1',
        scenes: [
          createNode({ id: 's1', parentId: 'c1', type: 'scene', title: 'S1', order: 0 }),
          createNode({ id: 's2', parentId: 'c1', type: 'scene', title: 'S2', order: 1 }),
          createNode({ id: 's3', parentId: 'c1', type: 'scene', title: 'S3', order: 2 }),
        ],
      },
    ];

    const moved = moveSceneInColumns(columns, 's3', 'c1', 'c1', 1);
    expect(moved[0].scenes.map((scene) => scene.id)).toEqual(['s1', 's3', 's2']);
  });

  it('moves scene across chapters and updates parentId', () => {
    const columns = [
      {
        chapterId: 'c1',
        chapterTitle: 'Chapter 1',
        scenes: [createNode({ id: 's1', parentId: 'c1', type: 'scene', title: 'S1', order: 0 })],
      },
      {
        chapterId: 'c2',
        chapterTitle: 'Chapter 2',
        scenes: [createNode({ id: 's2', parentId: 'c2', type: 'scene', title: 'S2', order: 0 })],
      },
    ];

    const moved = moveSceneInColumns(columns, 's1', 'c1', 'c2', 1);

    expect(moved[0].scenes).toHaveLength(0);
    expect(moved[1].scenes.map((scene) => scene.id)).toEqual(['s2', 's1']);
    expect(moved[1].scenes[1].parentId).toBe('c2');
  });

  it('moves multiple selected scenes as a batch', () => {
    const columns = [
      {
        chapterId: 'c1',
        chapterTitle: 'Chapter 1',
        scenes: [
          createNode({ id: 's1', parentId: 'c1', type: 'scene', title: 'S1', order: 0 }),
          createNode({ id: 's2', parentId: 'c1', type: 'scene', title: 'S2', order: 1 }),
          createNode({ id: 's3', parentId: 'c1', type: 'scene', title: 'S3', order: 2 }),
        ],
      },
      {
        chapterId: 'c2',
        chapterTitle: 'Chapter 2',
        scenes: [createNode({ id: 's4', parentId: 'c2', type: 'scene', title: 'S4', order: 0 })],
      },
    ];

    const moved = moveScenesInColumns(columns, ['s1', 's2'], 'c1', 'c2', 1);
    expect(moved[0].scenes.map((scene) => scene.id)).toEqual(['s3']);
    expect(moved[1].scenes.map((scene) => scene.id)).toEqual(['s4', 's1', 's2']);
  });
});
