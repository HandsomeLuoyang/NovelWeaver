import React, { useEffect } from 'react';
import { useStore } from './store';
import { Library } from './components/Library';
import { Outliner } from './components/Outliner';
import { Editor } from './components/Editor';
import { Icons } from './components/Icons';
import { ToastContainer } from './components/Toast';
import { AnimatePresence, motion } from 'framer-motion';
import { PersistenceService } from './services/persistence';
import { db } from './db';
import { useTaskQueueRunner } from './hooks/useTaskQueueRunner';
import { resolveThemeMode, resolveThemeVariant } from './services/theme';

const App: React.FC = () => {
  const { currentBook, isGenerating, generationStatus, theme, isZenMode, lightThemeVariant, darkThemeVariant } = useStore();
  useTaskQueueRunner();

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = (prefersDark: boolean) => {
      const resolvedMode = resolveThemeMode(theme, prefersDark);
      const resolvedVariant = resolveThemeVariant(resolvedMode, lightThemeVariant, darkThemeVariant);

      root.classList.remove('light', 'dark');
      root.classList.add(resolvedMode);
      root.dataset.themeMode = resolvedMode;
      root.dataset.themeVariant = resolvedVariant;
    };

    applyTheme(mediaQuery.matches);
    if (theme !== 'system') return;

    const handleChange = (event: MediaQueryListEvent) => applyTheme(event.matches);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [theme, lightThemeVariant, darkThemeVariant]);

  useEffect(() => {
    let saveTimer: number | null = null;
    const scheduleDiskSync = () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
      saveTimer = window.setTimeout(() => {
        void PersistenceService.saveToDisk();
      }, 800);
    };

    const booksCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const booksUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const booksDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const nodesCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const nodesUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const nodesDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const historyCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const historyUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const historyDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const snapshotsCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const snapshotsUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const snapshotsDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const deletedBooksCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const deletedBooksUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const deletedBooksDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const deletedNodesCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const deletedNodesUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const deletedNodesDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const factsCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const factsUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const factsDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const factCandidatesCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const factCandidatesUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const factCandidatesDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const foreshadowsCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const foreshadowsUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const foreshadowsDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const materialsCreatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const materialsUpdatingHook = (..._args: any[]) => { scheduleDiskSync(); };
    const materialsDeletingHook = (..._args: any[]) => { scheduleDiskSync(); };

    // Keep disk as source-of-truth by hydrating from disk snapshot first.
    const initPersistence = async () => {
      await PersistenceService.loadFromDisk(true);
      // Ensure local disk snapshot exists even on first run.
      await PersistenceService.saveToDisk();
    };
    void initPersistence();

    // Real-time sync on all DB mutations.
    db.books.hook('creating', booksCreatingHook);
    db.books.hook('updating', booksUpdatingHook);
    db.books.hook('deleting', booksDeletingHook);
    db.nodes.hook('creating', nodesCreatingHook);
    db.nodes.hook('updating', nodesUpdatingHook);
    db.nodes.hook('deleting', nodesDeletingHook);
    db.history.hook('creating', historyCreatingHook);
    db.history.hook('updating', historyUpdatingHook);
    db.history.hook('deleting', historyDeletingHook);
    db.snapshots.hook('creating', snapshotsCreatingHook);
    db.snapshots.hook('updating', snapshotsUpdatingHook);
    db.snapshots.hook('deleting', snapshotsDeletingHook);
    db.deletedBooks.hook('creating', deletedBooksCreatingHook);
    db.deletedBooks.hook('updating', deletedBooksUpdatingHook);
    db.deletedBooks.hook('deleting', deletedBooksDeletingHook);
    db.deletedNodes.hook('creating', deletedNodesCreatingHook);
    db.deletedNodes.hook('updating', deletedNodesUpdatingHook);
    db.deletedNodes.hook('deleting', deletedNodesDeletingHook);
    db.facts.hook('creating', factsCreatingHook);
    db.facts.hook('updating', factsUpdatingHook);
    db.facts.hook('deleting', factsDeletingHook);
    db.factCandidates.hook('creating', factCandidatesCreatingHook);
    db.factCandidates.hook('updating', factCandidatesUpdatingHook);
    db.factCandidates.hook('deleting', factCandidatesDeletingHook);
    db.foreshadows.hook('creating', foreshadowsCreatingHook);
    db.foreshadows.hook('updating', foreshadowsUpdatingHook);
    db.foreshadows.hook('deleting', foreshadowsDeletingHook);
    db.materials.hook('creating', materialsCreatingHook);
    db.materials.hook('updating', materialsUpdatingHook);
    db.materials.hook('deleting', materialsDeletingHook);

    // Auto-save every 30 seconds
    const interval = window.setInterval(() => {
      void PersistenceService.saveToDisk();
    }, 30000);

    // Save on visibility change (e.g. closing tab/switching app)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void PersistenceService.saveToDisk();
      }
    };
    const handlePageHide = () => {
      void PersistenceService.saveToDisk();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
      }
      db.books.hook('creating').unsubscribe(booksCreatingHook);
      db.books.hook('updating').unsubscribe(booksUpdatingHook);
      db.books.hook('deleting').unsubscribe(booksDeletingHook);
      db.nodes.hook('creating').unsubscribe(nodesCreatingHook);
      db.nodes.hook('updating').unsubscribe(nodesUpdatingHook);
      db.nodes.hook('deleting').unsubscribe(nodesDeletingHook);
      db.history.hook('creating').unsubscribe(historyCreatingHook);
      db.history.hook('updating').unsubscribe(historyUpdatingHook);
      db.history.hook('deleting').unsubscribe(historyDeletingHook);
      db.snapshots.hook('creating').unsubscribe(snapshotsCreatingHook);
      db.snapshots.hook('updating').unsubscribe(snapshotsUpdatingHook);
      db.snapshots.hook('deleting').unsubscribe(snapshotsDeletingHook);
      db.deletedBooks.hook('creating').unsubscribe(deletedBooksCreatingHook);
      db.deletedBooks.hook('updating').unsubscribe(deletedBooksUpdatingHook);
      db.deletedBooks.hook('deleting').unsubscribe(deletedBooksDeletingHook);
      db.deletedNodes.hook('creating').unsubscribe(deletedNodesCreatingHook);
      db.deletedNodes.hook('updating').unsubscribe(deletedNodesUpdatingHook);
      db.deletedNodes.hook('deleting').unsubscribe(deletedNodesDeletingHook);
      db.facts.hook('creating').unsubscribe(factsCreatingHook);
      db.facts.hook('updating').unsubscribe(factsUpdatingHook);
      db.facts.hook('deleting').unsubscribe(factsDeletingHook);
      db.factCandidates.hook('creating').unsubscribe(factCandidatesCreatingHook);
      db.factCandidates.hook('updating').unsubscribe(factCandidatesUpdatingHook);
      db.factCandidates.hook('deleting').unsubscribe(factCandidatesDeletingHook);
      db.foreshadows.hook('creating').unsubscribe(foreshadowsCreatingHook);
      db.foreshadows.hook('updating').unsubscribe(foreshadowsUpdatingHook);
      db.foreshadows.hook('deleting').unsubscribe(foreshadowsDeletingHook);
      db.materials.hook('creating').unsubscribe(materialsCreatingHook);
      db.materials.hook('updating').unsubscribe(materialsUpdatingHook);
      db.materials.hook('deleting').unsubscribe(materialsDeletingHook);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
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
