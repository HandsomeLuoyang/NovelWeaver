import React from 'react';
import { useStore } from './store';
import { Library } from './components/Library';
import { Outliner } from './components/Outliner';
import { Editor } from './components/Editor';
import { Icons } from './components/Icons';
import { ToastContainer } from './components/Toast';
import { AnimatePresence, motion } from 'framer-motion';
import { PersistenceService } from './services/persistence';
import { useEffect } from 'react';
import { useTaskQueueRunner } from './hooks/useTaskQueueRunner';

const App: React.FC = () => {
  const { currentBook, isGenerating, generationStatus, theme, isZenMode } = useStore();
  useTaskQueueRunner();

  useEffect(() => {
    // Theme handling
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    // Initialize persistence
    const initPersistence = async () => {
      await PersistenceService.loadFromDisk();
    };
    initPersistence();

    // Auto-save every 30 seconds
    const interval = setInterval(() => {
      PersistenceService.saveToDisk();
    }, 30000);

    // Save on visibility change (e.g. closing tab/switching app)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        PersistenceService.saveToDisk();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden font-sans selection:bg-emerald-500/30 relative">
      {!currentBook ? (
        <Library />
      ) : (
        <div className="flex w-full h-full">
          {!isZenMode && <Outliner />}
          <Editor />
        </div>
      )}

      {/* Toast Notifications */}
      <ToastContainer />

      {/* Floating AI Status Bar */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50"
          >
            <div className="bg-zinc-900/90 backdrop-blur-md border border-emerald-500/30 text-emerald-100 px-6 py-3 rounded-full shadow-2xl shadow-emerald-900/20 flex items-center space-x-3">
              <div className="relative">
                <Icons.Sparkles className="w-5 h-5 text-emerald-400 animate-spin" />
                <div className="absolute inset-0 bg-emerald-400 blur opacity-40 animate-pulse"></div>
              </div>
              <span className="text-sm font-medium tracking-wide">{generationStatus || "AI 正在思考..."}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
