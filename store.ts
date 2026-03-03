import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import { Book, AIModel, ModelConfig, ChatMessage, AITask, AITaskStatus, AITaskType } from './types';
import type { Toast } from './hooks/useToast';

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

  // Chat State (Ephemeral)
  chatHistory: Record<string, ChatMessage[]>; // bookId -> messages

  // AI Task Queue (Ephemeral)
  taskQueue: AITask[];
  isTaskQueuePaused: boolean;
  isTaskQueueRunning: boolean;

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

  // Toast Actions
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;

  // Settings Actions
  addModel: (model: AIModel) => void;
  updateModel: (model: AIModel) => void;
  removeModel: (id: string) => void;
  updateModelConfig: (config: Partial<ModelConfig>) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

type PersistedState = Pick<AppState, 'models' | 'modelConfig' | 'theme'>;

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

const SETTINGS_ENDPOINT = '/api/storage/models';
const TASK_QUEUE_STORAGE_KEY = 'novelweaver-task-queue';

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
    const parsed = JSON.parse(raw) as { taskQueue?: AITask[]; isTaskQueuePaused?: boolean };
    const queue = Array.isArray(parsed.taskQueue)
      ? parsed.taskQueue.map((task) => ({
          ...task,
          status: task.status === 'running' ? ('pending' as const) : task.status,
          updatedAt: task.updatedAt || Date.now()
        }))
      : [];

    return {
      taskQueue: queue,
      isTaskQueuePaused: Boolean(parsed.isTaskQueuePaused)
    };
  } catch (error) {
    console.error('Failed to parse local task queue snapshot:', error);
    return null;
  }
};

const persistTaskQueueSnapshot = (taskQueue: AITask[], isTaskQueuePaused: boolean) => {
  if (typeof window === 'undefined') return;

  const normalizedQueue = taskQueue.map((task) => ({
    ...task,
    status: task.status === 'running' ? ('pending' as const) : task.status
  }));
  const payload = {
    taskQueue: normalizedQueue,
    isTaskQueuePaused
  };

  window.localStorage.setItem(TASK_QUEUE_STORAGE_KEY, JSON.stringify(payload));
};

const restoredTaskQueueState = readTaskQueueSnapshot();

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
      toasts: [],

      models: defaultModels,
      modelConfig: defaultConfig,
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
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused);
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
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused);
        return { taskQueue: nextQueue };
      }),
      removeTask: (taskId) => set((state) => {
        const nextQueue = state.taskQueue.filter((task) => task.id !== taskId);
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused);
        return { taskQueue: nextQueue };
      }),
      clearCompletedTasks: () => set((state) => {
        const nextQueue = state.taskQueue.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
        persistTaskQueueSnapshot(nextQueue, state.isTaskQueuePaused);
        return { taskQueue: nextQueue };
      }),
      setTaskQueuePaused: (paused) => set((state) => {
        persistTaskQueueSnapshot(state.taskQueue, paused);
        return { isTaskQueuePaused: paused };
      }),
      setTaskQueueRunning: (running) => set({ isTaskQueueRunning: running }),

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
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'novelweaver-storage',
      storage: settingsStorage,
      onRehydrateStorage: () => (state) => {
        console.log('Settings rehydrated from local file');
      },
      partialize: (state): PersistedState => ({
        models: state.models,
        modelConfig: state.modelConfig,
        theme: state.theme
      }), // Only persist settings
    }
  )
);
