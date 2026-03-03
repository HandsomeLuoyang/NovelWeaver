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
  AIUsageEntry,
  EditorTypographySettings,
  PromptProfile,
} from './types';
import type { Toast } from './hooks/useToast';
import { DEFAULT_EDITOR_TYPOGRAPHY, sanitizeEditorTypography } from './services/typography';
import { clonePromptProfile, createDefaultPromptProfile, normalizePromptProfile, normalizePromptProfiles } from './services/promptProfiles';

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
  theme: 'light' | 'dark' | 'system';
  models: AIModel[];
  modelConfig: ModelConfig;
  editorTypography: EditorTypographySettings;
  promptProfiles: PromptProfile[];
  activePromptProfileId: string;

  // Chat State (Ephemeral)
  chatHistory: Record<string, ChatMessage[]>; // bookId -> messages

  // AI Task Queue (Ephemeral)
  taskQueue: AITask[];
  isTaskQueuePaused: boolean;
  isTaskQueueRunning: boolean;
  taskQueueConcurrency: number;
  usageLog: AIUsageEntry[];

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
  enqueueTask: (task: { type: AITaskType; bookId: string; nodeId: string; nodeTitle: string }) => void;
  updateTaskStatus: (taskId: string, status: AITaskStatus, error?: string) => void;
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
  setTaskQueuePaused: (paused: boolean) => void;
  setTaskQueueRunning: (running: boolean) => void;
  setTaskQueueConcurrency: (concurrency: number) => void;
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
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

type PersistedState = Pick<AppState, 'models' | 'modelConfig' | 'theme' | 'editorTypography' | 'promptProfiles' | 'activePromptProfileId'>;

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
  enableCreativitySeeds: true
};

const defaultPromptProfiles = normalizePromptProfiles([createDefaultPromptProfile()]);
const defaultActivePromptProfileId = defaultPromptProfiles[0]?.id || 'prompt-default';

const SETTINGS_ENDPOINT = '/api/storage/models';
const TASK_QUEUE_STORAGE_KEY = 'novelweaver-task-queue';
const AI_USAGE_STORAGE_KEY = 'novelweaver-ai-usage-log';

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

const resolvePromptState = (
  promptProfiles: PromptProfile[] | undefined,
  activePromptProfileId: string | undefined
) => {
  const normalizedProfiles = normalizePromptProfiles(promptProfiles);
  const hasActive = normalizedProfiles.some((profile) => profile.id === activePromptProfileId);

  return {
    promptProfiles: normalizedProfiles,
    activePromptProfileId: hasActive
      ? (activePromptProfileId as string)
      : normalizedProfiles[0]?.id || defaultActivePromptProfileId,
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
      chatHistory: {},
      taskQueue: restoredTaskQueueState?.taskQueue || [],
      isTaskQueuePaused: restoredTaskQueueState?.isTaskQueuePaused || false,
      isTaskQueueRunning: false,
      taskQueueConcurrency: restoredTaskQueueState?.taskQueueConcurrency || 1,
      usageLog: restoredUsageLog,
      toasts: [],

      models: defaultModels,
      modelConfig: defaultConfig,
      editorTypography: DEFAULT_EDITOR_TYPOGRAPHY,
      promptProfiles: defaultPromptProfiles,
      activePromptProfileId: defaultActivePromptProfileId,
      theme: 'system',

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
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}`,
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
        modelConfig: { ...state.modelConfig, ...cfg }
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
          };
        });
        return createdId;
      },
      savePromptProfile: (profile) => set((state) => {
        const normalized = normalizePromptProfile({
          ...profile,
          updatedAt: Date.now(),
        });
        const existingIndex = state.promptProfiles.findIndex((item) => item.id === normalized.id);
        const nextProfiles = existingIndex >= 0
          ? state.promptProfiles.map((item) => (item.id === normalized.id ? normalized : item))
          : [...state.promptProfiles, normalized];

        return {
          promptProfiles: normalizePromptProfiles(nextProfiles),
        };
      }),
      deletePromptProfile: (profileId) => set((state) => {
        const target = state.promptProfiles.find((profile) => profile.id === profileId);
        if (!target || target.isBuiltin) return {};

        const filtered = state.promptProfiles.filter((profile) => profile.id !== profileId);
        const resolved = resolvePromptState(filtered, state.activePromptProfileId === profileId ? undefined : state.activePromptProfileId);
        return resolved;
      }),
      setActivePromptProfile: (profileId) => set((state) => {
        const exists = state.promptProfiles.some((profile) => profile.id === profileId);
        if (!exists) return {};
        return { activePromptProfileId: profileId };
      }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'novelweaver-storage',
      storage: settingsStorage,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const resolved = resolvePromptState(state.promptProfiles, state.activePromptProfileId);
        const safeTypography = sanitizeEditorTypography(state.editorTypography || DEFAULT_EDITOR_TYPOGRAPHY);
        state.promptProfiles = resolved.promptProfiles;
        state.activePromptProfileId = resolved.activePromptProfileId;
        state.editorTypography = safeTypography;
        console.log('Settings rehydrated from local file');
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState || {}) as Partial<PersistedState>;
        const resolved = resolvePromptState(persisted.promptProfiles, persisted.activePromptProfileId);
        return {
          ...currentState,
          ...persisted,
          editorTypography: sanitizeEditorTypography(persisted.editorTypography || currentState.editorTypography),
          promptProfiles: resolved.promptProfiles,
          activePromptProfileId: resolved.activePromptProfileId,
        };
      },
      partialize: (state): PersistedState => ({
        models: state.models,
        modelConfig: state.modelConfig,
        theme: state.theme,
        editorTypography: state.editorTypography,
        promptProfiles: state.promptProfiles,
        activePromptProfileId: state.activePromptProfileId,
      }), // Only persist settings
    }
  )
);
