import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, applyStructureSnapshot } from '../db';
import { StoryNode, NodeType } from '../types';
import { expandNode } from '../services/geminiService';
import { useStore } from '../store';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';

interface StructureVariationModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: StoryNode; // The container node (Volume/Arc/Chapter)
}

export const StructureVariationModal: React.FC<StructureVariationModalProps> = ({
  isOpen,
  onClose,
  node,
}) => {
  const { currentBook, isGenerating, setGenerating } = useStore();
  const toast = useToast();
  const [generatingVariation, setGeneratingVariation] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

  const snapshots = useLiveQuery(
    () => db.snapshots.where('parentId').equals(node.id).reverse().sortBy('createdAt'),
    [node.id]
  );

  // Auto-select first snapshot
  useEffect(() => {
    if (snapshots && snapshots.length > 0 && !selectedSnapshotId) {
      setSelectedSnapshotId(snapshots[0].id);
    }
  }, [snapshots, selectedSnapshotId]);

  const selectedSnapshot = snapshots?.find(s => s.id === selectedSnapshotId);

  const handleGenerate = async () => {
    if (!currentBook) return;
    setGeneratingVariation(true);
    setGenerating(true);

    try {
      // 1. Snapshot current state as backup
      const currentChildren = await db.nodes.where('parentId').equals(node.id).sortBy('order');
      if (currentChildren.length > 0) {
        // Simple check to avoid duplicate "Original State" saves if one was just made
        const recent = await db.snapshots.where('parentId').equals(node.id).reverse().sortBy('createdAt');
        const isDuplicate = recent.length > 0 &&
            recent[0].source === 'user' &&
            JSON.stringify(recent[0].nodes.map(n => n.title)) === JSON.stringify(currentChildren.map(n => n.title));

        if (!isDuplicate) {
            await db.snapshots.add({
                id: crypto.randomUUID(),
                parentId: node.id,
                bookId: node.bookId,
                createdAt: Date.now(),
                source: 'user',
                name: 'Original State',
                nodes: currentChildren
            });
        }
      }

      // 2. Generate new structure snapshot (do not mutate current tree until Apply)
      const childType: NodeType = node.type === 'chapter' ? 'scene' : node.type === 'arc' ? 'chapter' : 'arc';
      const result = await expandNode(node, currentBook, childType);
      const newChildren = result.nodes.map((n, idx) => ({
        id: uuidv4(),
        bookId: node.bookId,
        parentId: node.id,
        type: childType,
        title: n.title,
        summary: n.summary,
        status: 'empty' as const,
        order: idx
      }));

      if (newChildren.length === 0) {
        throw new Error('AI returned empty structure');
      }

      // 3. Snapshot the generated result
      const newSnapshotId = crypto.randomUUID();

      await db.snapshots.add({
        id: newSnapshotId,
        parentId: node.id,
        bookId: node.bookId,
        createdAt: Date.now(),
        source: 'ai',
        name: `AI Variation ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
        nodes: newChildren
      });

      setSelectedSnapshotId(newSnapshotId);
      toast.success("New variation generated");

    } catch (error) {
      console.error("Failed to generate variation:", error);
      toast.error("Generation failed");
    } finally {
      setGeneratingVariation(false);
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!selectedSnapshotId) return;
    try {
      await applyStructureSnapshot(node.id, selectedSnapshotId);
      toast.success("Structure updated");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Failed to apply snapshot");
    }
  };

  const handleSaveCurrent = async () => {
    if (!currentBook) return;
    const currentChildren = await db.nodes.where('parentId').equals(node.id).sortBy('order');
    if (currentChildren.length === 0) {
        toast.error("No content to save");
        return;
    }
    const id = crypto.randomUUID();
    await db.snapshots.add({
      id,
      parentId: node.id,
      bookId: node.bookId,
      createdAt: Date.now(),
      source: 'user',
      name: `Manual Save ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
      nodes: currentChildren
    });
    setSelectedSnapshotId(id);
    toast.success("Current state saved");
  };

  const handleDeleteSnapshot = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this snapshot?')) {
      await db.snapshots.delete(id);
      if (selectedSnapshotId === id) setSelectedSnapshotId(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6" aria-modal="true" role="dialog">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/70 backdrop-blur-md"
          onClick={onClose}
        />

        {/* Modal Content */}
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative rounded-2xl shadow-2xl w-[95vw] max-w-7xl h-[90vh] flex flex-col overflow-hidden border border-border bg-card ui-rise-in"
        >
          {/* Header */}
          <div className="px-8 py-5 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900 z-10">
            <div className="flex items-center gap-4">
              <div className="p-2.5 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                <Icons.GitBranch className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                  Structure Variations
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                  Exploring possibilities for <span className="text-purple-600 dark:text-purple-400">"{node.title}"</span>
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all"
            >
              <Icons.X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar: Timeline */}
            <div className="w-80 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/50 backdrop-blur-sm">
              <div className="p-6 space-y-4">
                <button
                  onClick={handleGenerate}
                  disabled={generatingVariation || isGenerating}
                  className="w-full group relative flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold shadow-lg shadow-purple-500/20 transition-all disabled:opacity-70 disabled:cursor-not-allowed overflow-hidden"
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  {generatingVariation ? (
                    <Icons.Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icons.Sparkles className="w-5 h-5" />
                  )}
                  <span>{generatingVariation ? 'Dreaming...' : 'Dream New Variation'}</span>
                </button>

                <button
                  onClick={handleSaveCurrent}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 text-gray-700 dark:text-gray-200 font-medium transition-colors shadow-sm"
                >
                  <Icons.Save className="w-4 h-4" />
                  <span>Snapshot Current</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
                <div className="flex items-center gap-2 px-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <Icons.History className="w-3 h-3" />
                  Timeline
                </div>

                {snapshots?.length === 0 && (
                   <div className="text-center py-10 px-4">
                      <div className="w-12 h-12 bg-gray-200 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3">
                         <Icons.GitBranch className="w-6 h-6 text-gray-400" />
                      </div>
                      <p className="text-sm text-gray-500">No variations yet.</p>
                   </div>
                )}

                {snapshots?.map((snap) => (
                  <div
                    key={snap.id}
                    onClick={() => setSelectedSnapshotId(snap.id)}
                    className={`group relative p-4 rounded-xl cursor-pointer border transition-all duration-200 ${
                      selectedSnapshotId === snap.id
                        ? 'bg-white dark:bg-gray-800 border-purple-500 shadow-md ring-1 ring-purple-500/10 z-10'
                        : 'bg-white dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/50 hover:border-purple-300 dark:hover:border-purple-700/50 hover:shadow-sm'
                    }`}
                  >
                    {/* Source Badge */}
                    <div className="flex justify-between items-start mb-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                        snap.source === 'ai'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'
                          : snap.source === 'auto-backup'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                      }`}>
                        {snap.source === 'ai' ? <Icons.Sparkles className="w-3 h-3" /> : <Icons.User className="w-3 h-3" />}
                        {snap.source === 'ai' ? 'AI Generated' : snap.source === 'auto-backup' ? 'Auto Backup' : 'Manual Save'}
                      </span>

                      <button
                         onClick={(e) => handleDeleteSnapshot(e, snap.id)}
                         className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 hover:text-red-500 rounded-md transition-all text-gray-400"
                      >
                         <Icons.Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <h4 className={`font-semibold text-sm mb-1 line-clamp-1 ${
                        selectedSnapshotId === snap.id ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                    }`}>
                        {snap.name}
                    </h4>

                    <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
                        <span>{new Date(snap.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        <span className="flex items-center gap-1">
                            <Icons.Layers className="w-3 h-3" />
                            {snap.nodes.length}
                        </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Main Preview */}
            <div className="flex-1 bg-gray-50 dark:bg-black/20 flex flex-col relative overflow-hidden">
                {selectedSnapshot ? (
                    <>
                        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none mix-blend-soft-light"></div>

                        {/* Toolbar */}
                        <div className="px-8 py-4 flex items-center justify-between bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 z-10 sticky top-0">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    {selectedSnapshot.name}
                                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 font-mono font-normal border border-gray-200 dark:border-gray-700">
                                        {selectedSnapshot.id.slice(0, 8)}
                                    </span>
                                </h3>
                            </div>
                            <button
                                onClick={handleApply}
                                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold shadow-lg shadow-emerald-500/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                            >
                                <Icons.Check className="w-5 h-5" />
                                Apply This Version
                            </button>
                        </div>

                        {/* Grid Content */}
                        <div className="flex-1 overflow-y-auto p-8 z-0">
                            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 pb-20 max-w-[1600px] mx-auto">
                                {selectedSnapshot.nodes.map((n, idx) => (
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        key={`${selectedSnapshot.id}-${idx}`}
                                        className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-xl hover:border-purple-200 dark:hover:border-purple-800 transition-all group relative overflow-hidden"
                                    >
                                        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-purple-500/5 to-transparent rounded-bl-[100px] -mr-4 -mt-4 transition-transform group-hover:scale-110" />

                                        <div className="flex items-center gap-3 mb-4">
                                            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center text-xs font-bold text-gray-500 font-mono">
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                 <h4 className="font-bold text-gray-900 dark:text-gray-100 truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                                                    {n.title}
                                                 </h4>
                                            </div>
                                        </div>

                                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-5">
                                            {n.summary}
                                        </p>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8">
                        <Icons.Layout className="w-16 h-16 opacity-20 mb-4" />
                        <p>Select a version to preview details</p>
                    </div>
                )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
};
