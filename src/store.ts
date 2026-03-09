import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import {
  Book,
  AIModel,
  ModelConfig,
  ChatMessage,
  AITask,
  AITaskStatus,
  AITaskType,
  AITaskParams,
  AIReviewItem,
  AIUsageEntry,
  EditorTypographySettings,
  PromptProfile,
  PromptProfileRevision,
  WritingGoal,
  WorkspaceMode,
  SceneTemplate,
  ModelProbeLogEntry,
} from './types';
import type { Toast } from './hooks/useToast';
import { DEFAULT_EDITOR_TYPOGRAPHY, sanitizeEditorTypography } from './services/typography';
import { clonePromptProfile, createDefaultPromptProfile, normalizePromptProfile, normalizePromptProfiles } from './services/promptProfiles';
import {
  DEFAULT_DARK_THEME_VARIANT,
  DEFAULT_LIGHT_THEME_VARIANT,
  DarkThemeVariant,
  LightThemeVariant,
  sanitizeDarkThemeVariant,
  sanitizeLightThemeVariant,
  ThemeMode,
} from './services/theme';

interface AppState {
  // Session State (Not persisted usually, but for this app simplistic is fine)
  currentBook: Book | null;
  activeNodeId: string | null;
  expandedNodeIds: string[];
  isGenerating: boolean;
  generationStatus: string;
  isZenMode: boolean;
  workspaceMode: WorkspaceMode;

  // Toast notifications
  toasts: Toast[];

  // Settings State (Persisted)
  theme: ThemeMode;
  lightThemeVariant: LightThemeVariant;
  darkThemeVariant: DarkThemeVariant;
  models: AIModel[];
  modelConfig: ModelConfig;
  editorTypography: EditorTypographySettings;
  promptProfiles: PromptProfile[];
  activePromptProfileId: string;
  promptProfileRevisions: Record<string, PromptProfileRevision[]>;
  writingGoals: Record<string, WritingGoal>;
  editorSidebarWidth: number;
  sceneTemplates: SceneTemplate[];
  modelProbeLog: ModelProbeLogEntry[];

  // Chat State (Ephemeral)
  chatHistory: Record<string, ChatMessage[]>; // bookId -> messages

  // AI Task Queue (Ephemeral)
  taskQueue: AITask[];
  isTaskQueuePaused: boolean;
  isTaskQueueRunning: boolean;
  taskQueueConcurrency: number;
  usageLog: AIUsageEntry[];
  reviewInbox: AIReviewItem[];

  // Actions
  setCurrentBook: (book: Book | null) => void;
  setActiveNodeId: (id: string | null) => void;
  toggleNodeExpansion: (id: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setGenerationStatus: (status: string) => void;
  toggleZenMode: () => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;

  // Chat Actions
  addChatMessage: (bookId: string, message: ChatMessage) => void;
  clearChatHistory: (bookId: string) => void;

  // Queue Actions
  enqueueTask: (task: { type: AITaskType; bookId: string; nodeId: string; nodeTitle: string; params?: AITaskParams }) => void;
  updateTaskStatus: (taskId: string, status: AITaskStatus, error?: string) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  setTaskQueuePaused: (paused: boolean) => void;
  setTaskQueueRunning: (running: boolean) => void;
  setTaskQueueConcurrency: (concurrency: number) => void;
  addReviewItem: (result: AIReviewItem) => void;
  updateReviewItemStatus: (resultId: string, status: AIReviewItem['status']) => void;
  removeReviewItem: (resultId: string) => void;
  clearReviewInbox: () => void;
  addUsageEntry: (entry: AIUsageEntry) => void;
  clearUsageLog: () => void;

  // Toast Actions
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;

  // Settings Actions
  addModel: (model: AIModel) => void;
  updateModel: (model: AIModel) => void;
  removeModel: (id: string) => void;
  updateModelConfig: (config: Partial<ModelConfig>) => void;
  updateEditorTypography: (config: Partial<EditorTypographySettings>) => void;
  resetEditorTypography: () => void;
  createPromptProfile: (name?: string, sourceProfileId?: string) => string;
  duplicatePromptProfile: (profileId: string) => string | null;
  savePromptProfile: (profile: PromptProfile) => void;
  deletePromptProfile: (profileId: string) => void;
  setActivePromptProfile: (profileId: string) => void;
  importPromptProfiles: (profiles: PromptProfile[], options?: { activateFirst?: boolean }) => string[];
  rollbackPromptProfile: (profileId: string, revisionId: string) => void;
  setWritingGoal: (bookId: string, patch: Partial<WritingGoal>) => void;
  setEditorSidebarWidth: (width: number) => void;
  upsertSceneTemplate: (template: SceneTemplate) => void;
  removeSceneTemplate: (templateId: string) => void;
  addModelProbeLogEntry: (entry: ModelProbeLogEntry) => void;
  clearModelProbeLog: () => void;
  setTheme: (theme: ThemeMode) => void;
  setLightThemeVariant: (variant: LightThemeVariant) => void;
  setDarkThemeVariant: (variant: DarkThemeVariant) => void;
}

type PersistedState = Pick<
  AppState,
  'models'
  | 'modelConfig'
  | 'theme'
  | 'lightThemeVariant'
  | 'darkThemeVariant'
  | 'editorTypography'
  | 'promptProfiles'
  | 'activePromptProfileId'
  | 'promptProfileRevisions'
  | 'writingGoals'
  | 'workspaceMode'
  | 'editorSidebarWidth'
  | 'sceneTemplates'
  | 'modelProbeLog'
>;

const MODEL_ASSIGNMENT_KEYS = [
  'genesisModelId',
  'expansionModelId',
  'draftingModelId',
  'polishingModelId',
  'chatModelId',
] as const;

type ModelAssignmentKey = (typeof MODEL_ASSIGNMENT_KEYS)[number];

// Initial sample model (fully user editable/removable)
const initialModels: AIModel[] = [
  {
    id: 'sample-gemini-flash',
    name: '示例模型（可编辑）',
    provider: 'google',
    apiKey: '', // Empty implies using .env.local (VITE_GEMINI_API_KEY / VITE_API_KEY)
    modelName: 'gemini-1.5-flash'
  }
];

const defaultConfig: ModelConfig = {
  genesisModelId: 'sample-gemini-flash',
  expansionModelId: 'sample-gemini-flash',
  draftingModelId: 'sample-gemini-flash',
  polishingModelId: 'sample-gemini-flash',
  chatModelId: 'sample-gemini-flash',
  fallbackModelIds: {},
  maxRetries: {
    genesis: 1,
    expansion: 1,
    drafting: 1,
    polishing: 1,
    chat: 1,
  },
  creativityLevel: {
    genesis: 0.9,
    expansion: 0.8,
    drafting: 0.75,
    polishing: 0.6
  },
  enableQualityCheck: false,
  enableCreativitySeeds: true,
  creativeToolkit: {
    antiBlockMode: true,
    divergenceBoost: 0.65,
    twistIntensity: 0.55,
    paceVariance: 0.5,
  },
};

const defaultPromptProfiles = normalizePromptProfiles([createDefaultPromptProfile()]);
const defaultActivePromptProfileId = defaultPromptProfiles[0]?.id || 'prompt-default';
const defaultSceneTemplates: SceneTemplate[] = [
  {
    id: 'builtin-suspense-scene',
    name: '悬念场',
    description: '快速建立未知信息、危险感和结尾钩子。',
    builtin: true,
    metaPreset: {
      conflictType: '悬念',
      tags: ['悬念', '推进'],
      goal: '逼近真相',
      obstacle: '信息不完整且存在危险',
      turn: '发现比预期更坏的事实',
      outcome: '抛出更大问题',
    },
    summaryPrompt: '该场景需制造悬念并留下下一步钩子。',
    draftingPrompt: '让信息一点点露出，但不要一次说透，结尾必须留钩子。',
    updatedAt: 0,
  },
  {
    id: 'builtin-confrontation-scene',
    name: '对峙场',
    description: '强调双方目标冲突、筹码交换和关系变化。',
    builtin: true,
    metaPreset: {
      conflictType: '对峙',
      tags: ['冲突', '博弈'],
      goal: '逼对方表态',
      obstacle: '对方有底牌且不愿退让',
      turn: '局势反转，主动权转移',
      outcome: '关系或立场发生变化',
    },
    summaryPrompt: '该场景要把冲突摆到台面上，让关系发生明确变化。',
    draftingPrompt: '通过对白和动作体现博弈，不要只靠解释。',
    updatedAt: 0,
  },
  {
    id: 'builtin-emotion-scene',
    name: '情感推进场',
    description: '推进人物关系、情绪波动和内在决策。',
    builtin: true,
    metaPreset: {
      conflictType: '情感',
      tags: ['关系', '情绪'],
      goal: '确认关系或心意',
      obstacle: '误解、顾虑或旧伤',
      turn: '情绪被触发，防线松动',
      outcome: '关系发生靠近或疏离',
    },
    summaryPrompt: '该场景的重点是让关系或情绪状态发生一小步但明确的变化。',
    draftingPrompt: '用动作、停顿、潜台词表现情感，不要直接讲道理。',
    updatedAt: 0,
  },
  {
    id: 'builtin-reveal-scene',
    name: '信息揭示场',
    description: '投放关键信息，同时制造后续代价或误解。',
    builtin: true,
    metaPreset: {
      conflictType: '揭示',
      tags: ['信息', '反转'],
      goal: '让角色得知关键事实',
      obstacle: '信息来源不完整或不可信',
      turn: '真相带出新的风险',
      outcome: '角色做出新的选择',
    },
    summaryPrompt: '该场景要完成关键信息揭示，但不能让问题直接结束。',
    draftingPrompt: '揭示信息后立刻引出代价、误解或新的冲突。',
    updatedAt: 0,
  },
];

const SETTINGS_ENDPOINT = '/api/storage/models';
const TASK_QUEUE_STORAGE_KEY = 'novelweaver-task-queue';
const AI_USAGE_STORAGE_KEY = 'novelweaver-ai-usage-log';
const REVIEW_INBOX_STORAGE_KEY = 'novelweaver-review-inbox';
const MAX_PROMPT_REVISIONS = 20;

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const todayKey = () => new Date().toISOString().slice(0, 10);
const resolveApiEndpoint = (path: string) => {
  if (typeof window === 'undefined') return path;
  const origin = window.location?.origin && window.location.origin !== 'null'
    ? window.location.origin
    : 'http://localhost';
  return new URL(path, origin).toString();
};

const shouldUseSettingsApi = () => typeof window !== 'undefined' && !Boolean(import.meta.env.VITEST);
const shouldLogSettingsLifecycle = () => !Boolean(import.meta.env.VITEST);

const getBrowserStorage = () => {
  if (typeof window === 'undefined') return null;
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage) return null;
  return (
    typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function'
  ) ? storage as Storage : null;
};

const readFromLocalStorage = (name: string) => {
  const storage = getBrowserStorage();
  if (!storage) return null;
  const raw = storage.getItem(name);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as { state: PersistedState; version: number };
  } catch (error) {
    console.error('Failed to parse local settings cache:', error);
    return null;
  }
};

const settingsStorage: PersistStorage<PersistedState> = {
  getItem: async (name) => {
    if (!shouldUseSettingsApi()) {
      return readFromLocalStorage(name);
    }

    try {
      const response = await fetch(resolveApiEndpoint(SETTINGS_ENDPOINT));
      if (response.ok) {
        const data = await response.json();
        const storage = getBrowserStorage();
        if (storage) {
          storage.setItem(name, JSON.stringify(data));
        }
        return data;
      }
    } catch (error) {
      console.error('Failed to load settings from API, fallback to local cache.', error);
    }

    return readFromLocalStorage(name);
  },
  setItem: async (name, value) => {
    const storage = getBrowserStorage();
    if (storage) {
      storage.setItem(name, JSON.stringify(value));
    }

    if (!shouldUseSettingsApi()) {
      return;
    }

    try {
      await fetch(resolveApiEndpoint(SETTINGS_ENDPOINT), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    } catch (error) {
      console.error('Failed to save settings to API, local cache kept.', error);
    }
  },
  removeItem: async (name) => {
    const storage = getBrowserStorage();
    if (storage) {
      storage.removeItem(name);
    }
  },
};

const readTaskQueueSnapshot = () => {
  const storage = getBrowserStorage();
  if (!storage) return null;

  const raw = storage.getItem(TASK_QUEUE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      taskQueue?: AITask[];
      isTaskQueuePaused?: boolean;
      taskQueueConcurrency?: number;
    };
    const queue = Array.isArray(parsed.taskQueue)
      ? parsed.taskQueue.map((task) => ({
          ...task,
          status: task.status === 'running' ? ('pending' as const) : task.status,
          updatedAt: task.updatedAt || Date.now()
        }))
      : [];

    return {
      taskQueue: queue,
      isTaskQueuePaused: Boolean(parsed.isTaskQueuePaused),
      taskQueueConcurrency: Math.min(3, Math.max(1, Number(parsed.taskQueueConcurrency || 1)))
    };
  } catch (error) {
    console.error('Failed to parse local task queue snapshot:', error);
    return null;
  }
};

const persistTaskQueueSnapshot = (
  taskQueue: AITask[],
  isTaskQueuePaused: boolean,
  taskQueueConcurrency: number
) => {
  const storage = getBrowserStorage();
  if (!storage) return;

  const normalizedQueue = taskQueue.map((task) => ({
    ...task,
    status: task.status === 'running' ? ('pending' as const) : task.status
  }));
  const payload = {
    taskQueue: normalizedQueue,
    isTaskQueuePaused,
    taskQueueConcurrency
  };

  storage.setItem(TASK_QUEUE_STORAGE_KEY, JSON.stringify(payload));
};

const restoredTaskQueueState = readTaskQueueSnapshot();

const readUsageLog = () => {
  const storage = getBrowserStorage();
  if (!storage) return [] as AIUsageEntry[];

  const raw = storage.getItem(AI_USAGE_STORAGE_KEY);
  if (!raw) return [] as AIUsageEntry[];

  try {
    const parsed = JSON.parse(raw) as AIUsageEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse usage log cache:', error);
    return [] as AIUsageEntry[];
  }
};

const persistUsageLog = (usageLog: AIUsageEntry[]) => {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(usageLog.slice(0, 500)));
};

const restoredUsageLog = readUsageLog();

const readReviewInbox = () => {
  const storage = getBrowserStorage();
  if (!storage) return [] as AIReviewItem[];
  const raw = storage.getItem(REVIEW_INBOX_STORAGE_KEY);
  if (!raw) return [] as AIReviewItem[];

  try {
    const parsed = JSON.parse(raw) as AIReviewItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse review inbox cache:', error);
    return [] as AIReviewItem[];
  }
};

const persistReviewInbox = (results: AIReviewItem[]) => {
  const storage = getBrowserStorage();
  if (!storage) return;
  storage.setItem(REVIEW_INBOX_STORAGE_KEY, JSON.stringify(results.slice(0, 300)));
};

const restoredReviewInbox = readReviewInbox();

const normalizePromptRevisions = (
  revisions: Record<string, PromptProfileRevision[]> | undefined,
  profiles: PromptProfile[]
) => {
  const next: Record<string, PromptProfileRevision[]> = {};
  if (!revisions) return next;

  const profileIds = new Set(profiles.map((profile) => profile.id));
  Object.entries(revisions).forEach(([profileId, list]) => {
    if (!profileIds.has(profileId) || !Array.isArray(list) || list.length === 0) return;
    next[profileId] = list
      .filter((item) => item && item.snapshot)
      .slice(0, MAX_PROMPT_REVISIONS)
      .map((item) => ({
        ...item,
        snapshot: normalizePromptProfile(item.snapshot),
      }));
  });
  return next;
};

const resolvePromptState = (
  promptProfiles: PromptProfile[] | undefined,
  activePromptProfileId: string | undefined,
  promptProfileRevisions?: Record<string, PromptProfileRevision[]>
) => {
  const normalizedProfiles = normalizePromptProfiles(promptProfiles);
  const hasActive = normalizedProfiles.some((profile) => profile.id === activePromptProfileId);

  return {
    promptProfiles: normalizedProfiles,
    activePromptProfileId: hasActive
      ? (activePromptProfileId as string)
      : normalizedProfiles[0]?.id || defaultActivePromptProfileId,
    promptProfileRevisions: normalizePromptRevisions(promptProfileRevisions, normalizedProfiles),
  };
};

const resolveWritingGoals = (writingGoals: Record<string, WritingGoal> | undefined) => {
  if (!writingGoals) return {} as Record<string, WritingGoal>;
  const next: Record<string, WritingGoal> = {};
  Object.entries(writingGoals).forEach(([bookId, goal]) => {
    if (!goal) return;
    next[bookId] = {
      bookId,
      totalTargetWords: Math.max(1000, Number(goal.totalTargetWords || 100000)),
      dailyTargetWords: Math.max(100, Number(goal.dailyTargetWords || 2000)),
      targetDate: goal.targetDate,
      dailyBaselineDate: goal.dailyBaselineDate || todayKey(),
      dailyBaselineWordCount: Math.max(0, Number(goal.dailyBaselineWordCount || 0)),
    };
  });
  return next;
};

const resolveSceneTemplates = (sceneTemplates: SceneTemplate[] | undefined) => {
  const seen = new Set<string>();
  const merged = [...defaultSceneTemplates, ...(Array.isArray(sceneTemplates) ? sceneTemplates : [])];
  return merged.filter((template) => {
    if (!template?.id || !template.name || seen.has(template.id)) return false;
    seen.add(template.id);
    return true;
  });
};

const resolveModelProbeLog = (entries: ModelProbeLogEntry[] | undefined) => {
  if (!Array.isArray(entries)) return [] as ModelProbeLogEntry[];
  return entries
    .filter((entry) => entry?.id && entry.modelId && entry.modelName)
    .slice(0, 200);
};

const resolveModelConfig = (modelConfig: ModelConfig | undefined) => {
  const incoming = modelConfig || defaultConfig;
  return {
    ...defaultConfig,
    ...incoming,
    fallbackModelIds: {
      ...defaultConfig.fallbackModelIds,
      ...(incoming.fallbackModelIds || {}),
    },
    maxRetries: {
      ...defaultConfig.maxRetries,
      ...(incoming.maxRetries || {}),
    },
    creativityLevel: {
      ...defaultConfig.creativityLevel,
      ...(incoming.creativityLevel || {}),
    },
    creativeToolkit: {
      ...defaultConfig.creativeToolkit,
      ...(incoming.creativeToolkit || {}),
    },
  } as ModelConfig;
};

const sanitizeModels = (models: AIModel[] | undefined): AIModel[] => {
  if (!Array.isArray(models)) return [...initialModels];
  if (models.length === 0) return [];
  return models.filter((model) => model && model.id && model.name && model.modelName);
};

const resolveModelConfigWithModels = (
  models: AIModel[],
  modelConfig: ModelConfig | undefined
): ModelConfig => {
  const safeConfig = resolveModelConfig(modelConfig);
  const availableIds = new Set(models.map((model) => model.id));
  const fallbackModelId = models[0]?.id || '';
  const nextConfig = { ...safeConfig } as ModelConfig;

  MODEL_ASSIGNMENT_KEYS.forEach((key: ModelAssignmentKey) => {
    if (!availableIds.has(nextConfig[key])) {
      nextConfig[key] = fallbackModelId;
    }
  });

  (Object.keys(nextConfig.fallbackModelIds) as Array<keyof ModelConfig['fallbackModelIds']>).forEach((key) => {
    const fallbackId = nextConfig.fallbackModelIds[key];
    if (fallbackId && !availableIds.has(fallbackId)) {
      delete nextConfig.fallbackModelIds[key];
    }
  });

  return nextConfig;
};

const resolveModelState = (models: AIModel[] | undefined, modelConfig: ModelConfig | undefined) => {
  const safeModels = sanitizeModels(models);
  return {
    models: safeModels,
    modelConfig: resolveModelConfigWithModels(safeModels, modelConfig),
  };
};

export const useStore = create<AppState>()(
  persist<AppState, [], [], PersistedState>(
    (set) => ({
      currentBook: null,
      activeNodeId: null,
      expandedNodeIds: [],
      isGenerating: false,
      generationStatus: '',
      isZenMode: false,
      workspaceMode: 'write',
      chatHistory: {},
      taskQueue: restoredTaskQueueState?.taskQueue || [],
      isTaskQueuePaused: restoredTaskQueueState?.isTaskQueuePaused || false,
      isTaskQueueRunning: false,
      taskQueueConcurrency: restoredTaskQueueState?.taskQueueConcurrency || 1,
      usageLog: restoredUsageLog,
      reviewInbox: restoredReviewInbox,
      toasts: [],

      models: initialModels,
      modelConfig: defaultConfig,
      editorTypography: DEFAULT_EDITOR_TYPOGRAPHY,
      promptProfiles: defaultPromptProfiles,
      activePromptProfileId: defaultActivePromptProfileId,
      promptProfileRevisions: {},
      writingGoals: {},
      editorSidebarWidth: 320,
      sceneTemplates: defaultSceneTemplates,
      modelProbeLog: [],
      theme: 'system',
      lightThemeVariant: DEFAULT_LIGHT_THEME_VARIANT,
      darkThemeVariant: DEFAULT_DARK_THEME_VARIANT,

      setCurrentBook: (book) => set((state) => {
        if (!book) {
          return { currentBook: null, activeNodeId: null, expandedNodeIds: [], chatHistory: {} };
        }

        // If only metadata changed for the same book, keep current editing context.
        if (state.currentBook?.id === book.id) {
          return { currentBook: book };
        }

        return { currentBook: book, activeNodeId: null, expandedNodeIds: [], chatHistory: {} };
      }),
      setActiveNodeId: (id) => set({ activeNodeId: id }),
      toggleNodeExpansion: (id) => set((state) => {
        const isExpanded = state.expandedNodeIds.includes(id);
        return {
          expandedNodeIds: isExpanded
            ? state.expandedNodeIds.filter(nid => nid !== id)
            : [...state.expandedNodeIds, id]
        };
      }),
      setGenerating: (val) => set({ isGenerating: val }),
      setGenerationStatus: (status) => set({ generationStatus: status }),
      toggleZenMode: () => set((state) => ({ isZenMode: !state.isZenMode })),
      setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),

      addChatMessage: (bookId, message) => set((state) => ({
        chatHistory: {
          ...state.chatHistory,
          [bookId]: [...(state.chatHistory[bookId] || []), message]
        }
      })),
      clearChatHistory: (bookId) => set((state) => ({
        chatHistory: {
          ...state.chatHistory,
          [bookId]: []
        }
      })),

      enqueueTask: (task) => set((state) => {
        const now = Date.now();
        const nextQueue: AITask[] = [
          ...state.taskQueue,
          {
            id: createId(),
            ...task,
            status: 'pending' as const,
            createdAt: now,
            updatedAt: now
          }
        ];
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused, state.taskQueueConcurrency);
        return {
          taskQueue: nextQueue
        };
      }),
      updateTaskStatus: (taskId, status, error) => set((state) => {
        const nextQueue = state.taskQueue.map((task) =>
          task.id === taskId
            ? { ...task, status, error, updatedAt: Date.now() }
            : task
        );
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused, state.taskQueueConcurrency);
        return { taskQueue: nextQueue };
      }),
      removeTask: (taskId) => set((state) => {
        const nextQueue = state.taskQueue.filter((task) => task.id !== taskId);
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused, state.taskQueueConcurrency);
        return { taskQueue: nextQueue };
      }),
      clearCompletedTasks: () => set((state) => {
        const nextQueue = state.taskQueue.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused, state.taskQueueConcurrency);
        return { taskQueue: nextQueue };
      }),
      setTaskQueuePaused: (paused) => set((state) => {
        persistTaskQueueSnapshot(state.taskQueue, paused, state.taskQueueConcurrency);
        return { isTaskQueuePaused: paused };
      }),
      setTaskQueueRunning: (running) => set({ isTaskQueueRunning: running }),
      setTaskQueueConcurrency: (concurrency) => set((state) => {
        const safeConcurrency = Math.min(3, Math.max(1, Math.round(concurrency)));
        persistTaskQueueSnapshot(state.taskQueue, state.isTaskQueuePaused, safeConcurrency);
        return { taskQueueConcurrency: safeConcurrency };
      }),
      addReviewItem: (result) => set((state) => {
        const next = [result, ...state.reviewInbox];
        persistReviewInbox(next);
        return { reviewInbox: next };
      }),
      updateReviewItemStatus: (resultId, status) => set((state) => {
        const next = state.reviewInbox.map((item) => (
          item.id === resultId
            ? { ...item, status, reviewedAt: Date.now() }
            : item
        ));
        persistReviewInbox(next);
        return { reviewInbox: next };
      }),
      removeReviewItem: (resultId) => set((state) => {
        const next = state.reviewInbox.filter((result) => result.id !== resultId);
        persistReviewInbox(next);
        return { reviewInbox: next };
      }),
      clearReviewInbox: () => set(() => {
        persistReviewInbox([]);
        return { reviewInbox: [] };
      }),
      addUsageEntry: (entry) => set((state) => {
        const nextLog = [entry, ...state.usageLog].slice(0, 500);
        persistUsageLog(nextLog);
        return { usageLog: nextLog };
      }),
      clearUsageLog: () => set(() => {
        persistUsageLog([]);
        return { usageLog: [] };
      }),

      addToast: (toast) => set((state) => ({ toasts: [...state.toasts, toast] })),
      removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),

      addModel: (model) => set((state) => {
        const nextModels = [...state.models, model];
        return {
          models: nextModels,
          modelConfig: resolveModelConfigWithModels(nextModels, state.modelConfig),
        };
      }),
      updateModel: (updatedModel) => set((state) => ({
        models: state.models.map(m => m.id === updatedModel.id ? updatedModel : m)
      })),
      removeModel: (id) => set((state) => {
        const nextModels = state.models.filter((m) => m.id !== id);
        return {
          models: nextModels,
          modelConfig: resolveModelConfigWithModels(nextModels, state.modelConfig),
        };
      }),
      updateModelConfig: (cfg) => set((state) => ({
        modelConfig: resolveModelConfigWithModels(state.models, {
          ...state.modelConfig,
          ...cfg
        })
      })),
      updateEditorTypography: (cfg) => set((state) => ({
        editorTypography: sanitizeEditorTypography({
          ...state.editorTypography,
          ...cfg,
        })
      })),
      resetEditorTypography: () => set(() => ({
        editorTypography: DEFAULT_EDITOR_TYPOGRAPHY
      })),
      createPromptProfile: (name, sourceProfileId) => {
        let createdId = '';
        set((state) => {
          const sourceProfile = state.promptProfiles.find((profile) => profile.id === sourceProfileId)
            || state.promptProfiles.find((profile) => profile.id === state.activePromptProfileId)
            || state.promptProfiles[0]
            || createDefaultPromptProfile();

          const created = clonePromptProfile(sourceProfile, name);
          createdId = created.id;
          return {
            promptProfiles: normalizePromptProfiles([...state.promptProfiles, created]),
            activePromptProfileId: created.id,
            promptProfileRevisions: {
              ...state.promptProfileRevisions,
              [created.id]: [],
            },
          };
        });
        return createdId;
      },
      duplicatePromptProfile: (profileId) => {
        let createdId: string | null = null;
        set((state) => {
          const sourceProfile = state.promptProfiles.find((profile) => profile.id === profileId);
          if (!sourceProfile) return {};
          const duplicated = clonePromptProfile(sourceProfile);
          createdId = duplicated.id;
          return {
            promptProfiles: normalizePromptProfiles([...state.promptProfiles, duplicated]),
            activePromptProfileId: duplicated.id,
            promptProfileRevisions: {
              ...state.promptProfileRevisions,
              [duplicated.id]: [],
            },
          };
        });
        return createdId;
      },
      savePromptProfile: (profile) => set((state) => {
        const before = state.promptProfiles.find((item) => item.id === profile.id);
        const normalized = normalizePromptProfile({
          ...profile,
          updatedAt: Date.now(),
        });
        const existingIndex = state.promptProfiles.findIndex((item) => item.id === normalized.id);
        const nextProfiles = existingIndex >= 0
          ? state.promptProfiles.map((item) => (item.id === normalized.id ? normalized : item))
          : [...state.promptProfiles, normalized];

        const revisionEntry = before
          ? {
              id: createId(),
              profileId: before.id,
              createdAt: Date.now(),
              snapshot: normalizePromptProfile(before),
            }
          : null;
        const existingRevisions = state.promptProfileRevisions[normalized.id] || [];
        const nextRevisions = revisionEntry
          ? [revisionEntry, ...existingRevisions].slice(0, MAX_PROMPT_REVISIONS)
          : existingRevisions;

        return {
          promptProfiles: normalizePromptProfiles(nextProfiles),
          promptProfileRevisions: {
            ...state.promptProfileRevisions,
            [normalized.id]: nextRevisions,
          },
        };
      }),
      deletePromptProfile: (profileId) => set((state) => {
        const target = state.promptProfiles.find((profile) => profile.id === profileId);
        if (!target || target.isBuiltin) return {};

        const filtered = state.promptProfiles.filter((profile) => profile.id !== profileId);
        const resolved = resolvePromptState(
          filtered,
          state.activePromptProfileId === profileId ? undefined : state.activePromptProfileId,
          state.promptProfileRevisions
        );
        return {
          ...resolved,
          promptProfileRevisions: Object.fromEntries(
            Object.entries(resolved.promptProfileRevisions).filter(([id]) => id !== profileId)
          ),
        };
      }),
      setActivePromptProfile: (profileId) => set((state) => {
        const exists = state.promptProfiles.some((profile) => profile.id === profileId);
        if (!exists) return {};
        return { activePromptProfileId: profileId };
      }),
      importPromptProfiles: (profiles, options) => {
        const importedIds: string[] = [];
        set((state) => {
          const imported = profiles.map((profile) => {
          const normalized = normalizePromptProfile(profile);
          const resolvedId = state.promptProfiles.some((existing) => existing.id === normalized.id) ? createId() : normalized.id;
          importedIds.push(resolvedId);
          return {
            ...normalized,
            id: resolvedId,
            isBuiltin: false,
            createdAt: normalized.createdAt || Date.now(),
            updatedAt: Date.now(),
          };
        });
        const nextProfiles = normalizePromptProfiles([...state.promptProfiles, ...imported]);
        const activateFirst = options?.activateFirst !== false;
        return {
          promptProfiles: nextProfiles,
          activePromptProfileId: activateFirst && imported[0] ? imported[0].id : state.activePromptProfileId,
          promptProfileRevisions: imported.reduce((acc, profile) => {
            acc[profile.id] = [];
            return acc;
          }, { ...state.promptProfileRevisions } as Record<string, PromptProfileRevision[]>),
        };
        });
        return importedIds;
      },
      rollbackPromptProfile: (profileId, revisionId) => set((state) => {
        const revisions = state.promptProfileRevisions[profileId] || [];
        const revision = revisions.find((item) => item.id === revisionId);
        if (!revision) return {};

        const restored = normalizePromptProfile({
          ...revision.snapshot,
          id: profileId,
          updatedAt: Date.now(),
        });

        return {
          promptProfiles: state.promptProfiles.map((profile) => (profile.id === profileId ? restored : profile)),
        };
      }),
      setWritingGoal: (bookId, patch) => set((state) => {
        const current = state.writingGoals[bookId];
        const merged: WritingGoal = {
          bookId,
          totalTargetWords: Math.max(1000, Number(patch.totalTargetWords || current?.totalTargetWords || 100000)),
          dailyTargetWords: Math.max(100, Number(patch.dailyTargetWords || current?.dailyTargetWords || 2000)),
          targetDate: patch.targetDate ?? current?.targetDate,
          dailyBaselineDate: patch.dailyBaselineDate || current?.dailyBaselineDate || todayKey(),
          dailyBaselineWordCount: Math.max(
            0,
            Number(
              patch.dailyBaselineWordCount !== undefined
                ? patch.dailyBaselineWordCount
                : (current?.dailyBaselineWordCount || 0)
            )
          ),
        };
        return {
          writingGoals: {
            ...state.writingGoals,
            [bookId]: merged,
          },
        };
      }),
      setEditorSidebarWidth: (width) => set({
        editorSidebarWidth: Math.min(520, Math.max(280, Math.round(width))),
      }),
      upsertSceneTemplate: (template) => set((state) => ({
        sceneTemplates: resolveSceneTemplates([
          ...state.sceneTemplates.filter((item) => item.id !== template.id),
          {
            ...template,
            updatedAt: Date.now(),
          },
        ]),
      })),
      removeSceneTemplate: (templateId) => set((state) => ({
        sceneTemplates: state.sceneTemplates.filter((template) => template.builtin || template.id !== templateId),
      })),
      addModelProbeLogEntry: (entry) => set((state) => ({
        modelProbeLog: resolveModelProbeLog([entry, ...state.modelProbeLog]),
      })),
      clearModelProbeLog: () => set({ modelProbeLog: [] }),
      setTheme: (theme) => set({ theme }),
      setLightThemeVariant: (variant) => set({ lightThemeVariant: sanitizeLightThemeVariant(variant) }),
      setDarkThemeVariant: (variant) => set({ darkThemeVariant: sanitizeDarkThemeVariant(variant) }),
    }),
    {
      name: 'novelweaver-storage',
      storage: settingsStorage,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved = resolvePromptState(state.promptProfiles, state.activePromptProfileId, state.promptProfileRevisions);
        const safeTypography = sanitizeEditorTypography(state.editorTypography || DEFAULT_EDITOR_TYPOGRAPHY);
        state.promptProfiles = resolved.promptProfiles;
        state.activePromptProfileId = resolved.activePromptProfileId;
        state.promptProfileRevisions = resolved.promptProfileRevisions;
        state.editorTypography = safeTypography;
        state.writingGoals = resolveWritingGoals(state.writingGoals);
        state.sceneTemplates = resolveSceneTemplates(state.sceneTemplates);
        state.modelProbeLog = resolveModelProbeLog(state.modelProbeLog);
        state.editorSidebarWidth = Math.min(520, Math.max(280, Math.round(state.editorSidebarWidth || 320)));
        const resolvedModels = resolveModelState(state.models, state.modelConfig);
        state.models = resolvedModels.models;
        state.modelConfig = resolvedModels.modelConfig;
        state.lightThemeVariant = sanitizeLightThemeVariant(state.lightThemeVariant);
        state.darkThemeVariant = sanitizeDarkThemeVariant(state.darkThemeVariant);
        if (shouldLogSettingsLifecycle()) {
          console.log('Settings rehydrated from local file');
        }
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<PersistedState>;
        const resolved = resolvePromptState(
          persisted.promptProfiles,
          persisted.activePromptProfileId,
          persisted.promptProfileRevisions
        );
        const resolvedModels = resolveModelState(
          persisted.models,
          persisted.modelConfig || currentState.modelConfig
        );

        return {
          ...currentState,
          ...persisted,
          editorTypography: sanitizeEditorTypography(persisted.editorTypography || currentState.editorTypography),
          models: resolvedModels.models,
          modelConfig: resolvedModels.modelConfig,
          promptProfiles: resolved.promptProfiles,
          activePromptProfileId: resolved.activePromptProfileId,
          promptProfileRevisions: resolved.promptProfileRevisions,
          writingGoals: resolveWritingGoals(persisted.writingGoals),
          workspaceMode: persisted.workspaceMode || currentState.workspaceMode,
          editorSidebarWidth: Math.min(520, Math.max(280, Math.round(persisted.editorSidebarWidth || currentState.editorSidebarWidth))),
          sceneTemplates: resolveSceneTemplates(persisted.sceneTemplates),
          modelProbeLog: resolveModelProbeLog(persisted.modelProbeLog),
          lightThemeVariant: sanitizeLightThemeVariant(persisted.lightThemeVariant || currentState.lightThemeVariant),
          darkThemeVariant: sanitizeDarkThemeVariant(persisted.darkThemeVariant || currentState.darkThemeVariant),
        };
      },
      partialize: (state): PersistedState => ({
        models: state.models,
        modelConfig: state.modelConfig,
        theme: state.theme,
        lightThemeVariant: state.lightThemeVariant,
        darkThemeVariant: state.darkThemeVariant,
        editorTypography: state.editorTypography,
        promptProfiles: state.promptProfiles,
        activePromptProfileId: state.activePromptProfileId,
        promptProfileRevisions: state.promptProfileRevisions,
        writingGoals: state.writingGoals,
        workspaceMode: state.workspaceMode,
        editorSidebarWidth: state.editorSidebarWidth,
        sceneTemplates: state.sceneTemplates,
        modelProbeLog: state.modelProbeLog,
      }), // Only persist settings
    }
  )
);
