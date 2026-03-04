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
  AITaskResult,
  AIUsageEntry,
  EditorTypographySettings,
  PromptProfile,
  PromptProfileRevision,
  WritingGoal,
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

  // Chat State (Ephemeral)
  chatHistory: Record<string, ChatMessage[]>; // bookId -> messages

  // AI Task Queue (Ephemeral)
  taskQueue: AITask[];
  isTaskQueuePaused: boolean;
  isTaskQueueRunning: boolean;
  taskQueueConcurrency: number;
  usageLog: AIUsageEntry[];
  taskResults: AITaskResult[];

  // Actions
  setCurrentBook: (book: Book | null) => void;
  setActiveNodeId: (id: string | null) => void;
  toggleNodeExpansion: (id: string) => void;
  setGenerating: (isGenerating: boolean) => void;
  setGenerationStatus: (status: string) => void;
  toggleZenMode: () => void;

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
  addTaskResult: (result: AITaskResult) => void;
  removeTaskResult: (resultId: string) => void;
  clearTaskResults: () => void;
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
>;

// Default Models
const defaultModels: AIModel[] = [
  {
    id: 'default-pro',
    name: 'Gemini 1.5 Pro (System)',
    provider: 'google',
    apiKey: '', // Empty implies using .env.local (VITE_GEMINI_API_KEY / VITE_API_KEY)
    modelName: 'gemini-1.5-pro'
  },
  {
    id: 'default-flash',
    name: 'Gemini 1.5 Flash (System)',
    provider: 'google',
    apiKey: '',
    modelName: 'gemini-1.5-flash'
  }
];

const defaultConfig: ModelConfig = {
  genesisModelId: 'default-pro',
  expansionModelId: 'default-pro',
  draftingModelId: 'default-flash',
  polishingModelId: 'default-flash',
  chatModelId: 'default-flash',
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

const SETTINGS_ENDPOINT = '/api/storage/models';
const TASK_QUEUE_STORAGE_KEY = 'novelweaver-task-queue';
const AI_USAGE_STORAGE_KEY = 'novelweaver-ai-usage-log';
const TASK_RESULTS_STORAGE_KEY = 'novelweaver-task-results';
const MAX_PROMPT_REVISIONS = 20;

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const todayKey = () => new Date().toISOString().slice(0, 10);

const readFromLocalStorage = (name: string) => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(name);
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
    try {
      const response = await fetch(SETTINGS_ENDPOINT);
      if (response.ok) {
        const data = await response.json();
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(name, JSON.stringify(data));
        }
        return data;
      }
    } catch (error) {
      console.error('Failed to load settings from API, fallback to local cache.', error);
    }

    return readFromLocalStorage(name);
  },
  setItem: async (name, value) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(name, JSON.stringify(value));
    }

    try {
      await fetch(SETTINGS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    } catch (error) {
      console.error('Failed to save settings to API, local cache kept.', error);
    }
  },
  removeItem: async (name) => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(name);
    }
  },
};

const readTaskQueueSnapshot = () => {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(TASK_QUEUE_STORAGE_KEY);
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
  if (typeof window === 'undefined') return;

  const normalizedQueue = taskQueue.map((task) => ({
    ...task,
    status: task.status === 'running' ? ('pending' as const) : task.status
  }));
  const payload = {
    taskQueue: normalizedQueue,
    isTaskQueuePaused,
    taskQueueConcurrency
  };

  window.localStorage.setItem(TASK_QUEUE_STORAGE_KEY, JSON.stringify(payload));
};

const restoredTaskQueueState = readTaskQueueSnapshot();

const readUsageLog = () => {
  if (typeof window === 'undefined') return [] as AIUsageEntry[];

  const raw = window.localStorage.getItem(AI_USAGE_STORAGE_KEY);
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
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AI_USAGE_STORAGE_KEY, JSON.stringify(usageLog.slice(0, 500)));
};

const restoredUsageLog = readUsageLog();

const readTaskResults = () => {
  if (typeof window === 'undefined') return [] as AITaskResult[];
  const raw = window.localStorage.getItem(TASK_RESULTS_STORAGE_KEY);
  if (!raw) return [] as AITaskResult[];

  try {
    const parsed = JSON.parse(raw) as AITaskResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse task results cache:', error);
    return [] as AITaskResult[];
  }
};

const persistTaskResults = (results: AITaskResult[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TASK_RESULTS_STORAGE_KEY, JSON.stringify(results.slice(0, 200)));
};

const restoredTaskResults = readTaskResults();

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

const resolveModelConfig = (modelConfig: ModelConfig | undefined) => {
  const incoming = modelConfig || defaultConfig;
  return {
    ...defaultConfig,
    ...incoming,
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

export const useStore = create<AppState>()(
  persist<AppState, [], [], PersistedState>(
    (set) => ({
      currentBook: null,
      activeNodeId: null,
      expandedNodeIds: [],
      isGenerating: false,
      generationStatus: '',
      isZenMode: false,
      chatHistory: {},
      taskQueue: restoredTaskQueueState?.taskQueue || [],
      isTaskQueuePaused: restoredTaskQueueState?.isTaskQueuePaused || false,
      isTaskQueueRunning: false,
      taskQueueConcurrency: restoredTaskQueueState?.taskQueueConcurrency || 1,
      usageLog: restoredUsageLog,
      taskResults: restoredTaskResults,
      toasts: [],

      models: defaultModels,
      modelConfig: defaultConfig,
      editorTypography: DEFAULT_EDITOR_TYPOGRAPHY,
      promptProfiles: defaultPromptProfiles,
      activePromptProfileId: defaultActivePromptProfileId,
      promptProfileRevisions: {},
      writingGoals: {},
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
      addTaskResult: (result) => set((state) => {
        const next = [result, ...state.taskResults];
        persistTaskResults(next);
        return { taskResults: next };
      }),
      removeTaskResult: (resultId) => set((state) => {
        const next = state.taskResults.filter((result) => result.id !== resultId);
        persistTaskResults(next);
        return { taskResults: next };
      }),
      clearTaskResults: () => set(() => {
        persistTaskResults([]);
        return { taskResults: [] };
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

      addModel: (model) => set((state) => ({ models: [...state.models, model] })),
      updateModel: (updatedModel) => set((state) => ({
        models: state.models.map(m => m.id === updatedModel.id ? updatedModel : m)
      })),
      removeModel: (id) => set((state) => ({
        models: state.models.filter(m => m.id !== id)
      })),
      updateModelConfig: (cfg) => set((state) => ({
        modelConfig: resolveModelConfig({
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
        state.modelConfig = resolveModelConfig(state.modelConfig);
        state.lightThemeVariant = sanitizeLightThemeVariant(state.lightThemeVariant);
        state.darkThemeVariant = sanitizeDarkThemeVariant(state.darkThemeVariant);
        console.log('Settings rehydrated from local file');
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<PersistedState>;
        const resolved = resolvePromptState(
          persisted.promptProfiles,
          persisted.activePromptProfileId,
          persisted.promptProfileRevisions
        );
        return {
          ...currentState,
          ...persisted,
          editorTypography: sanitizeEditorTypography(persisted.editorTypography || currentState.editorTypography),
          modelConfig: resolveModelConfig(persisted.modelConfig || currentState.modelConfig),
          promptProfiles: resolved.promptProfiles,
          activePromptProfileId: resolved.activePromptProfileId,
          promptProfileRevisions: resolved.promptProfileRevisions,
          writingGoals: resolveWritingGoals(persisted.writingGoals),
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
      }), // Only persist settings
    }
  )
);
