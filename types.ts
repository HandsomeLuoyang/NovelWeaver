export type NodeType = 'volume' | 'arc' | 'chapter' | 'scene';
export type NodeStatus = 'empty' | 'outlined' | 'drafted';

export type WritingStyle =
  | 'realistic'      // 现实主义（平实、克制）
  | 'poetic'         // 诗意派（意象、韵律）
  | 'noir'           // 黑色幽默（讽刺、荒诞）
  | 'suspense'       // 悬疑（悬念、反转）
  | 'minimalist'     // 极简主义（冰山理论）
  | 'maximalist'     // 巴洛克式（华丽、繁复）
  | 'balanced';      // 平衡型（默认）

export interface Character {
  name: string;
  role: string;
  description: string;
  secret: string;
}

export interface Book {
  id: string;
  title: string;
  premise: string;
  worldSetting: string;
  characters: Character[];
  wordCount: number;
  createdAt: number;
  writingStyle?: WritingStyle; // 写作风格
  styleReferences?: string[];  // 参考作品
}

export interface StoryNode {
  id: string;
  bookId: string;
  parentId: string | null; // null for top-level nodes (Volumes)
  type: NodeType;
  title: string;
  summary: string;
  content?: string; // Only for scenes
  status: NodeStatus;
  order: number;
  meta?: {
    pov?: string;
    timeTag?: string;
    location?: string;
    participants?: string[];
    conflictType?: string;
    tags?: string[];
  };
}

export interface GenesisResponse {
  title: string;
  premise: string; // Expanded premise
  worldSetting: string;
  characters: Character[];
  initialVolumes: { title: string; summary: string }[];
}

export interface ExpansionResponse {
  nodes: { title: string; summary: string }[];
}

// AI Model Management
export interface AIModel {
  id: string;
  name: string; // User friendly name e.g. "My Paid Pro Key"
  provider: 'google' | 'openai'; // For now just google, extensible later
  apiKey: string;
  baseUrl?: string; // Optional custom endpoint
  modelName: string; // e.g. "gemini-1.5-pro"
}

export interface ModelConfig {
  genesisModelId: string;
  expansionModelId: string;
  draftingModelId: string;
  polishingModelId: string;
  chatModelId: string;
  // 创意度控制（温度参数 0-1）
  creativityLevel: {
    genesis: number;      // 0.8-1.0 高创意
    expansion: number;    // 0.7-0.9
    drafting: number;     // 0.6-0.8
    polishing: number;    // 0.5-0.7
  };
  // 质量检测开关
  enableQualityCheck: boolean;
  // 灵感种子开关
  enableCreativitySeeds: boolean;
}

export interface ExportData {
  version: number;
  book: Book;
  nodes: StoryNode[];
  history?: HistoryEntry[];
}

export type HistoryAction = 'manual' | 'ai-draft' | 'ai-polish' | 'restore';

export interface HistoryEntry {
  id?: number;
  nodeId: string;
  content: string;
  timestamp: number;
  action?: HistoryAction;
}

export type SnapshotSource = 'ai' | 'user' | 'auto-backup';

export interface StructureSnapshot {
  id: string;
  parentId: string;
  bookId: string;
  createdAt: number;
  source: SnapshotSource;
  name: string;
  nodes: StoryNode[];
}

export interface DeletedBookEntry {
  id: string;
  deletedAt: number;
  title: string;
  data: {
    book: Book;
    nodes: StoryNode[];
    history: HistoryEntry[];
    snapshots: StructureSnapshot[];
  };
}

export interface DeletedNodeEntry {
  id: string;
  bookId: string;
  rootNodeId: string;
  rootNodeTitle: string;
  rootParentId: string | null;
  deletedAt: number;
  data: {
    nodes: StoryNode[];
    history: HistoryEntry[];
    snapshots: StructureSnapshot[];
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  bookId: string;
  title: string;
  createdAt: number;
  messages: ChatMessage[];
}

export type AITaskType = 'expansion' | 'draft' | 'polish';
export type AITaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AITask {
  id: string;
  type: AITaskType;
  bookId: string;
  nodeId: string;
  nodeTitle: string;
  status: AITaskStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}
