import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { createAutoSnapshotForParent, db, moveNodeToRecycleBin } from '../db';
import { StoryNode, NodeType } from '../types';
import { Icons } from './Icons';
import { expandNode } from '../services/geminiService';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useToast } from '../hooks/useToast';
import { NodeCreateModal } from './NodeCreateModal';
import { StructureVariationModal } from './StructureVariationModal';
import { NodeRecycleBinModal } from './NodeRecycleBinModal';

// Recursive Node Component
const NodeItem: React.FC<{ node: StoryNode; level: number }> = ({ node, level }) => {
    const { expandedNodeIds, toggleNodeExpansion, activeNodeId, setActiveNodeId, currentBook, setGenerating, isGenerating } = useStore();
    const toast = useToast();
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showVariationModal, setShowVariationModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(node.title);

    const isExpanded = expandedNodeIds.includes(node.id);
    const isActive = activeNodeId === node.id;

    // Load children using useLiveQuery (REACTIVE!)
    const children = useLiveQuery(
        () => db.nodes.where({ parentId: node.id }).sortBy('order'),
        [node.id]
    ) || [];

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setActiveNodeId(node.id);
        if (!isLeaf) toggleNodeExpansion(node.id);
    };

    const getNodeTypeName = (type: NodeType) => {
        switch (type) {
            case 'volume': return '卷';
            case 'arc': return '剧情';
            case 'chapter': return '章';
            case 'scene': return '场景';
            default: return type;
        }
    };

    const getNodeColor = (type: NodeType) => {
        switch (type) {
            case 'volume': return 'text-purple-600 dark:text-purple-400';
            case 'arc': return 'text-blue-600 dark:text-blue-400';
            case 'chapter': return 'text-emerald-600 dark:text-emerald-400';
            case 'scene': return 'text-orange-600 dark:text-orange-400';
        }
    };

    const isLeaf = node.type === 'scene';

    const getChildType = (): NodeType | null => {
        switch (node.type) {
            case 'volume': return 'arc';
            case 'arc': return 'chapter';
            case 'chapter': return 'scene';
            default: return null;
        }
    };

    const generateChildrenForNode = async (
        targetNode: StoryNode,
        childType: NodeType,
        options: { skipIfHasChildren?: boolean } = {}
    ) => {
        const existingChildrenCount = await db.nodes.where({ parentId: targetNode.id }).count();
        if (options.skipIfHasChildren && existingChildrenCount > 0) {
            return { createdCount: 0, skipped: true };
        }
        if (existingChildrenCount > 0) {
            await createAutoSnapshotForParent(targetNode.id, 'expand');
        }

        const result = await expandNode(targetNode, currentBook!, childType);
        const newNodes: StoryNode[] = result.nodes.map((n, idx) => ({
            id: uuidv4(),
            bookId: currentBook!.id,
            parentId: targetNode.id,
            type: childType,
            title: n.title,
            summary: n.summary,
            status: 'empty',
            order: existingChildrenCount + idx
        }));

        if (newNodes.length > 0) {
            await db.nodes.bulkAdd(newNodes);
        }
        await db.nodes.update(targetNode.id, { status: 'outlined' });

        return { createdCount: newNodes.length, skipped: false };
    };

    const expandCurrentNodeOnly = async () => {
        if (!currentBook) return;

        const childType = getChildType();
        if (!childType) return;

        setGenerating(true);
        if (!isExpanded) toggleNodeExpansion(node.id);

        try {
            const { createdCount } = await generateChildrenForNode(node, childType);
            toast.success(`已为「${node.title}」生成 ${createdCount} 个子节点`);
        } catch (error) {
            console.error("Expansion failed", error);
            toast.error("扩写失败，请稍后重试", {
                label: "重试",
                onClick: () => { void expandCurrentNodeOnly(); }
            });
        } finally {
            setGenerating(false);
        }
    };

    const expandAllNodesAtCurrentLevel = async () => {
        if (!currentBook) return;

        const childType = getChildType();
        if (!childType) return;

        setGenerating(true);
        if (!isExpanded) toggleNodeExpansion(node.id);

        try {
            const sameLevelNodes = await db.nodes
                .where('bookId')
                .equals(currentBook.id)
                .filter((n) => n.type === node.type)
                .toArray();

            sameLevelNodes.sort((a, b) => {
                const parentA = a.parentId ?? '';
                const parentB = b.parentId ?? '';
                if (parentA !== parentB) return parentA.localeCompare(parentB);
                return a.order - b.order;
            });

            let generatedParents = 0;
            let generatedChildren = 0;
            let skippedParents = 0;
            let failedParents = 0;

            for (const targetNode of sameLevelNodes) {
                try {
                    const { createdCount, skipped } = await generateChildrenForNode(targetNode, childType, {
                        skipIfHasChildren: true
                    });

                    if (skipped) {
                        skippedParents += 1;
                        continue;
                    }

                    generatedParents += 1;
                    generatedChildren += createdCount;
                } catch (error) {
                    failedParents += 1;
                    console.error(`Batch expansion failed for node ${targetNode.id}`, error);
                }
            }

            const childTypeName = getNodeTypeName(childType);
            if (generatedParents > 0) {
                toast.success(`批量生成完成：${generatedParents} 个父节点，新增 ${generatedChildren} 个${childTypeName}`);
            } else if (skippedParents > 0 && failedParents === 0) {
                toast.info("批量生成完成：目标节点已有子节点，未新增内容");
            } else {
                toast.warning("批量生成完成，但没有新增内容");
            }

            if (failedParents > 0) {
                toast.warning(`有 ${failedParents} 个节点生成失败，请稍后重试`);
            }
        } catch (error) {
            console.error("Batch expansion failed", error);
            toast.error("批量扩写失败，请稍后重试", {
                label: "重试",
                onClick: () => { void expandAllNodesAtCurrentLevel(); }
            });
        } finally {
            setGenerating(false);
        }
    };

    const handleExpandAI = (e: React.MouseEvent) => {
        e.stopPropagation();
        void expandCurrentNodeOnly();
    };

    const handleExpandAllAI = (e: React.MouseEvent) => {
        e.stopPropagation();
        void expandAllNodesAtCurrentLevel();
    };

    const handleManualCreate = async (title: string, summary: string) => {
        const childType = getChildType();
        if (!childType || !currentBook) return;

        const childrenCount = children.length;
        if (childrenCount > 0) {
            await createAutoSnapshotForParent(node.id, 'manual-create');
        }
        const newNode: StoryNode = {
            id: uuidv4(),
            bookId: currentBook.id,
            parentId: node.id,
            type: childType,
            title,
            summary,
            status: 'empty',
            order: childrenCount
        };

        await db.nodes.add(newNode);
        if (!isExpanded) toggleNodeExpansion(node.id);
        toast.success(`${getNodeTypeName(childType)} 已创建`);
    };

    const handleSaveTitle = async () => {
        if (editTitle.trim() && editTitle.trim() !== node.title) {
            await db.nodes.update(node.id, { title: editTitle.trim() });
            toast.success('标题已更新');
        } else {
            setEditTitle(node.title); // Revert if empty or unchanged
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSaveTitle();
        } else if (e.key === 'Escape') {
            setEditTitle(node.title);
            setIsEditing(false);
        }
    };

    return (
        <>
            <div className="select-none relative">
                <div
                    className={`
                group flex items-center py-1.5 px-2 rounded-lg cursor-pointer transition-colors
                ${isActive ? 'bg-secondary border border-border' : 'hover:bg-secondary/50 border border-transparent'}
            `}
                    style={{ marginLeft: `${level * 16}px` }}
                    onClick={handleClick}
                >
                    <div className="flex items-center justify-center w-5 h-5 mr-1 text-muted-foreground hover:text-foreground transition-colors">
                        {!isLeaf && (
                            isExpanded ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />
                        )}
                        {isLeaf && <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 group-hover:bg-zinc-600 dark:bg-zinc-700 dark:group-hover:bg-zinc-500" />}
                    </div>

                    <div className={`mr-2 text-xs font-mono uppercase tracking-wider opacity-70 ${getNodeColor(node.type)}`}>
                        {getNodeTypeName(node.type)}
                    </div>

                    {isEditing ? (
                        <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onBlur={handleSaveTitle}
                            onKeyDown={handleKeyDown}
                            className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-background border border-primary/50 rounded focus:outline-none focus:ring-1 focus:ring-primary z-20"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <span className={`text-sm truncate flex-1 ${isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                            {node.title}
                        </span>
                    )}

                    {/* Quick Actions */}
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditTitle(node.title);
                                setIsEditing(true);
                            }}
                            className="p-1 hover:bg-primary/20 hover:text-primary rounded mr-1"
                            title="重命名"
                        >
                            <Icons.Edit size={12} />
                        </button>
                        {!isLeaf && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowCreateModal(true);
                                    }}
                                    disabled={isGenerating}
                                    title="手动创建子节点"
                                    className="p-1 hover:bg-emerald-500/20 hover:text-emerald-600 rounded mr-1"
                                >
                                    <Icons.Plus size={12} />
                                </button>
                                <button
                                    onClick={handleExpandAI}
                                    disabled={isGenerating}
                                    title="AI 智能扩写"
                                    className="p-1 hover:bg-primary/20 hover:text-primary rounded mr-1"
                                >
                                    <Icons.Sparkles size={12} />
                                </button>
                                <button
                                    onClick={handleExpandAllAI}
                                    disabled={isGenerating}
                                    title="生成下一层级完整内容（同层全部节点）"
                                    className="p-1 hover:bg-cyan-500/20 hover:text-cyan-600 rounded mr-1"
                                >
                                    <Icons.Layers size={12} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowVariationModal(true);
                                    }}
                                    disabled={isGenerating}
                                    title="结构推演/变体"
                                    className="p-1 hover:bg-purple-500/20 hover:text-purple-600 rounded mr-1"
                                >
                                    <Icons.GitBranch size={12} />
                                </button>
                            </>
                        )}
                        {/* Delete */}
                        <button
                            onClick={async (e) => {
                                e.stopPropagation();
                                if (confirm("确定删除此节点吗？它会先进入回收站，可稍后恢复。")) {
                                    await moveNodeToRecycleBin(node.id);
                                    toast.success('节点已移入回收站');
                                }
                            }}
                            className="p-1 hover:bg-destructive/10 hover:text-destructive rounded"
                        >
                            <Icons.Trash2 size={12} />
                        </button>
                    </div>
                </div>

                <AnimatePresence>
                    {isExpanded && !isLeaf && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            {children.map(child => (
                                <NodeItem key={child.id} node={child} level={level + 1} />
                            ))}
                            {children.length === 0 && (
                                <div className="pl-8 py-2">
                                    {isGenerating ? (
                                        <div className="flex items-center space-x-2 text-xs text-emerald-600 dark:text-emerald-400">
                                            <div className="flex space-x-1">
                                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
                                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '100ms' }}></div>
                                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '200ms' }}></div>
                                            </div>
                                            <span className="font-medium">AI 正在生成子节点，请稍候...</span>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground italic">
                                            空空如也。点击 + 手动创建、✨ 生成当前节点，或 Layers 按钮批量生成同层节点。
                                        </div>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Create Modal */}
            {!isLeaf && getChildType() && (
                <NodeCreateModal
                    isOpen={showCreateModal}
                    onClose={() => setShowCreateModal(false)}
                    onConfirm={handleManualCreate}
                    nodeType={getChildType()!}
                />
            )}

            {/* Variation Modal */}
            {!isLeaf && (
                <StructureVariationModal
                    isOpen={showVariationModal}
                    onClose={() => setShowVariationModal(false)}
                    node={node}
                />
            )}
        </>
    );
};

export const Outliner: React.FC = () => {
    const { currentBook, setCurrentBook, setActiveNodeId, expandedNodeIds, toggleNodeExpansion } = useStore();
    const toast = useToast();
    const [isFloatingOutlinerOpen, setIsFloatingOutlinerOpen] = useState(false);
    const [isNodeRecycleBinOpen, setIsNodeRecycleBinOpen] = useState(false);
    const [outlineSearch, setOutlineSearch] = useState('');
    const [showRootCreateModal, setShowRootCreateModal] = useState(false);

    // Reactive root nodes
    const rootNodes = useLiveQuery(
        () => {
            if (!currentBook) return [];
            return db.nodes.where('bookId').equals(currentBook.id)
                .filter(node => node.parentId === null)
                .sortBy('order');
        },
        [currentBook?.id]
    ) || [];

    const allNodes = useLiveQuery(
        () => {
            if (!currentBook) return [];
            return db.nodes.where('bookId').equals(currentBook.id).toArray();
        },
        [currentBook?.id]
    ) || [];

    useEffect(() => {
        if (!isFloatingOutlinerOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsFloatingOutlinerOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFloatingOutlinerOpen]);

    if (!currentBook) return null;

    const getNodeTypeName = (type: NodeType) => {
        switch (type) {
            case 'volume': return '卷';
            case 'arc': return '剧情';
            case 'chapter': return '章';
            case 'scene': return '场景';
            default: return type;
        }
    };

    const normalizeSearch = outlineSearch.trim().toLowerCase();
    const searchResults = normalizeSearch
        ? allNodes
            .filter(node =>
                node.title.toLowerCase().includes(normalizeSearch) ||
                node.summary.toLowerCase().includes(normalizeSearch) ||
                (node.content || '').toLowerCase().includes(normalizeSearch)
            )
            .slice(0, 30)
        : [];

    const handleJumpToNode = (target: StoryNode) => {
        setActiveNodeId(target.id);

        const nodeMap = new Map(allNodes.map(n => [n.id, n]));
        let parentId = target.parentId;
        while (parentId) {
            if (!expandedNodeIds.includes(parentId)) {
                toggleNodeExpansion(parentId);
            }
            parentId = nodeMap.get(parentId)?.parentId || null;
        }
        setOutlineSearch('');
    };

    const getNodePath = (target: StoryNode) => {
        const nodeMap = new Map(allNodes.map(n => [n.id, n]));
        const path: string[] = [target.title];
        let parentId = target.parentId;
        while (parentId) {
            const parent = nodeMap.get(parentId);
            if (!parent) break;
            path.unshift(parent.title);
            parentId = parent.parentId;
        }
        return path.join(' / ');
    };

    const handleCreateRootVolume = async (title: string, summary: string) => {
        if (!currentBook) return;

        const nextOrder = rootNodes.reduce((maxOrder, node) => Math.max(maxOrder, node.order), -1) + 1;
        const newNode: StoryNode = {
            id: uuidv4(),
            bookId: currentBook.id,
            parentId: null,
            type: 'volume',
            title: title.trim(),
            summary: summary.trim(),
            status: 'empty',
            order: nextOrder
        };

        await db.nodes.add(newNode);
        setActiveNodeId(newNode.id);
        toast.success('已创建新卷');
    };

    return (
        <>
            <div className="w-80 border-r border-border bg-card/50 backdrop-blur-sm flex flex-col h-full z-10 shadow-xl">
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <button onClick={() => setCurrentBook(null)} className="text-muted-foreground hover:text-foreground flex items-center text-sm">
                        <Icons.Library size={14} className="mr-2" />
                        返回书架
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowRootCreateModal(true)}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                            title="新增卷"
                        >
                            <Icons.Plus size={14} />
                        </button>
                        <button
                            onClick={() => setIsNodeRecycleBinOpen(true)}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                            title="节点回收站"
                        >
                            <Icons.Trash2 size={14} />
                        </button>
                        <button
                            onClick={() => setIsFloatingOutlinerOpen(true)}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
                            title="浮窗浏览大纲"
                        >
                            <Icons.Maximize size={14} />
                        </button>
                        <span className="text-xs text-muted-foreground font-mono">STORY TREE</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                    <div className="mb-4 px-2">
                        <h2 className="text-lg font-bold text-foreground truncate">{currentBook.title}</h2>
                        <p className="text-xs text-muted-foreground mt-1">分形递归大纲</p>
                    </div>

                    <div className="relative px-2 mb-3">
                        <Icons.Search size={14} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            value={outlineSearch}
                            onChange={(e) => setOutlineSearch(e.target.value)}
                            placeholder="搜索标题/摘要/正文并跳转..."
                            className="w-full bg-secondary/60 border border-border rounded-lg py-2 pl-8 pr-8 text-xs text-foreground focus:outline-none focus:border-primary/40"
                        />
                        {outlineSearch && (
                            <button
                                onClick={() => setOutlineSearch('')}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <Icons.X size={12} />
                            </button>
                        )}
                    </div>

                    {searchResults.length > 0 && (
                        <div className="mx-2 mb-3 max-h-52 overflow-y-auto bg-card border border-border rounded-lg p-1 scrollbar-thin">
                            {searchResults.map((result) => (
                                <button
                                    key={`search-${result.id}`}
                                    onClick={() => handleJumpToNode(result)}
                                    className="w-full text-left px-2 py-2 rounded hover:bg-secondary/60 transition-colors"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs text-foreground font-medium truncate">{result.title}</span>
                                        <span className="text-[10px] text-muted-foreground">{getNodeTypeName(result.type)}</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate mt-1">{getNodePath(result)}</div>
                                </button>
                            ))}
                        </div>
                    )}

                    {rootNodes.length === 0 && (
                        <div className="mx-2 mb-3 rounded-lg border border-dashed border-border p-3 bg-secondary/20">
                            <p className="text-xs text-muted-foreground mb-2">当前没有任何卷节点。</p>
                            <button
                                onClick={() => setShowRootCreateModal(true)}
                                className="inline-flex items-center px-2.5 py-1.5 rounded bg-primary text-primary-foreground text-xs hover:bg-primary/90 transition-colors"
                            >
                                <Icons.Plus size={12} className="mr-1" />
                                创建第一卷
                            </button>
                        </div>
                    )}

                    {rootNodes.map(node => (
                        <NodeItem key={node.id} node={node} level={0} />
                    ))}
                </div>
            </div>

            {isFloatingOutlinerOpen && (
                <div
                    className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={() => setIsFloatingOutlinerOpen(false)}
                >
                    <div
                        className="w-full max-w-6xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-semibold text-foreground">大纲浮窗浏览</h3>
                                <p className="text-xs text-muted-foreground mt-1">{currentBook.title}</p>
                            </div>
                            <button
                                onClick={() => setIsFloatingOutlinerOpen(false)}
                                className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                title="关闭"
                            >
                                <Icons.Close size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
                            <div className="relative mb-4">
                                <Icons.Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input
                                    value={outlineSearch}
                                    onChange={(e) => setOutlineSearch(e.target.value)}
                                    placeholder="搜索标题/摘要/正文并跳转..."
                                    className="w-full bg-secondary/60 border border-border rounded-lg py-2 pl-8 pr-8 text-xs text-foreground focus:outline-none focus:border-primary/40"
                                />
                                {outlineSearch && (
                                    <button
                                        onClick={() => setOutlineSearch('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        <Icons.X size={12} />
                                    </button>
                                )}
                            </div>
                            {searchResults.length > 0 && (
                                <div className="mb-4 max-h-56 overflow-y-auto bg-card border border-border rounded-lg p-2 scrollbar-thin">
                                    {searchResults.map((result) => (
                                        <button
                                            key={`floating-search-${result.id}`}
                                            onClick={() => handleJumpToNode(result)}
                                            className="w-full text-left px-2 py-2 rounded hover:bg-secondary/60 transition-colors"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs text-foreground font-medium truncate">{result.title}</span>
                                                <span className="text-[10px] text-muted-foreground">{getNodeTypeName(result.type)}</span>
                                            </div>
                                            <div className="text-[10px] text-muted-foreground truncate mt-1">{getNodePath(result)}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {rootNodes.length === 0 && (
                                <div className="mb-4 rounded-lg border border-dashed border-border p-4 bg-secondary/20">
                                    <p className="text-sm text-muted-foreground mb-3">当前没有任何卷节点。</p>
                                    <button
                                        onClick={() => setShowRootCreateModal(true)}
                                        className="inline-flex items-center px-3 py-2 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
                                    >
                                        <Icons.Plus size={14} className="mr-1.5" />
                                        创建第一卷
                                    </button>
                                </div>
                            )}
                            {rootNodes.map(node => (
                                <NodeItem key={`floating-${node.id}`} node={node} level={0} />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <NodeCreateModal
                isOpen={showRootCreateModal}
                onClose={() => setShowRootCreateModal(false)}
                onConfirm={handleCreateRootVolume}
                nodeType="volume"
            />

            <NodeRecycleBinModal
                isOpen={isNodeRecycleBinOpen}
                onClose={() => setIsNodeRecycleBinOpen(false)}
                bookId={currentBook.id}
                onRestored={(nodeId) => {
                    setActiveNodeId(nodeId);
                    toast.success('已定位到恢复节点');
                }}
            />
        </>
    );
};
