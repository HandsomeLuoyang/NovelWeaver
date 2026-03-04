import { StoryNode } from '../types';

export interface SceneColumnData {
  chapterId: string;
  chapterTitle: string;
  scenes: StoryNode[];
}

export const moveSceneInColumns = (
  columns: SceneColumnData[],
  sceneId: string,
  fromChapterId: string,
  toChapterId: string,
  toIndex: number,
): SceneColumnData[] => {
  const draft = columns.map((column) => ({ ...column, scenes: [...column.scenes] }));
  const fromColumn = draft.find((column) => column.chapterId === fromChapterId);
  const toColumn = draft.find((column) => column.chapterId === toChapterId);
  if (!fromColumn || !toColumn) return columns;

  const sourceIndex = fromColumn.scenes.findIndex((scene) => scene.id === sceneId);
  if (sourceIndex < 0) return columns;

  const [movedScene] = fromColumn.scenes.splice(sourceIndex, 1);
  if (!movedScene) return columns;

  let insertIndex = Math.max(0, Math.min(toIndex, toColumn.scenes.length));

  // Same-column moves need index re-basing after removal.
  if (fromChapterId === toChapterId) {
    if (sourceIndex < insertIndex) {
      insertIndex -= 1;
    }
    if (sourceIndex === insertIndex) {
      return columns;
    }
  }

  toColumn.scenes.splice(insertIndex, 0, {
    ...movedScene,
    parentId: toChapterId,
  });

  return draft;
};

export const moveScenesInColumns = (
  columns: SceneColumnData[],
  sceneIds: string[],
  fromChapterId: string,
  toChapterId: string,
  toIndex: number,
): SceneColumnData[] => {
  if (sceneIds.length === 0) return columns;

  let draft = columns;
  let insertIndex = toIndex;

  sceneIds.forEach((sceneId, order) => {
    draft = moveSceneInColumns(
      draft,
      sceneId,
      fromChapterId,
      toChapterId,
      Math.max(0, insertIndex + order),
    );
  });

  return draft;
};
