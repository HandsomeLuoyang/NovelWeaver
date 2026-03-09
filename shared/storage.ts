import type {
  Book,
  BookCheckpoint,
  DeletedBookEntry,
  DeletedNodeEntry,
  FactCandidate,
  FactEntry,
  ForeshadowEntry,
  HistoryEntry,
  MaterialEntry,
  ReferenceLink,
  SceneCharacterState,
  StoryNode,
  StructureSnapshot,
} from '../src/types.ts';

export interface ContentSnapshot {
  version: number;
  books: Book[];
  nodes: StoryNode[];
  history: HistoryEntry[];
  snapshots: StructureSnapshot[];
  deletedBooks: DeletedBookEntry[];
  deletedNodes: DeletedNodeEntry[];
  facts: FactEntry[];
  factCandidates: FactCandidate[];
  foreshadows: ForeshadowEntry[];
  materials: MaterialEntry[];
  characterStates: SceneCharacterState[];
  checkpoints: BookCheckpoint[];
  references: ReferenceLink[];
}

export interface SettingsSnapshot {
  state: Record<string, unknown>;
  version: number;
}

export const createEmptyContentSnapshot = (): ContentSnapshot => ({
  version: 1,
  books: [],
  nodes: [],
  history: [],
  snapshots: [],
  deletedBooks: [],
  deletedNodes: [],
  facts: [],
  factCandidates: [],
  foreshadows: [],
  materials: [],
  characterStates: [],
  checkpoints: [],
  references: [],
});

export const createEmptySettingsSnapshot = (): SettingsSnapshot => ({
  state: {},
  version: 0,
});
