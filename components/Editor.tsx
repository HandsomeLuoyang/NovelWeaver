import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { db, getLinearContext, getAncestors, saveHistory, getHistory } from '../db';
import { StoryNode, HistoryEntry } from '../types';
import { Icons } from './Icons';
import { useAIWriter } from '../hooks/useAIWriter';
import { BookSettingsModal } from './BookSettingsModal';
import { useLiveQuery } from 'dexie-react-hooks';
import { DiffViewer } from './DiffViewer';
import { useToast } from '../hooks/useToast';
import { ChatPanel } from './ChatPanel';
import { DraftSettingsModal } from './DraftSettingsModal';
import { ModelSettingsModal } from './ModelSettingsModal';
import { TaskQueueModal } from './TaskQueueModal';
import { ConsistencyCheckModal } from './ConsistencyCheckModal';
import { WritingStats } from './WritingStats';
import { AIReviewModal } from './AIReviewModal';
import { AIUsagePanel } from './AIUsagePanel';
import { CommandPalette, PaletteCommand } from './CommandPalette';
import { PluginCenterModal } from './PluginCenterModal';
import { PublishWorkflowModal } from './PublishWorkflowModal';
import { TypographySettingsModal } from './TypographySettingsModal';

type FloatingContextPanel = 'node-summary' | 'parent-summary' | 'scene-meta' | 'world' | 'characters' | null;
type AIReviewState =
    | {
        mode: 'draft';
        originalContent: string;
        generatedContent: string;
    }
    | {
        mode: 'polish';
        originalContent: string;
        generatedContent: string;
        preContext: string;
        postContext: string;
    };

export const Editor: React.FC = () => {
    const { activeNodeId, currentBook, setCurrentBook, isGenerating: isGlobalGenerating, isZenMode, toggleZenMode, editorTypography } = useStore();
    const { isGenerating, stopGeneration, handleAIDraft: aiDraft, handleAIPolish: aiPolish } = useAIWriter();
    const toast = useToast();

    const [node, setNode] = useState<StoryNode | null>(null);
    const [content, setContent] = useState('');
    const [parentNode, setParentNode] = useState<StoryNode | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'diff'>('edit');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isDraftSettingsOpen, setIsDraftSettingsOpen] = useState(false);
    const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
    const [isTaskQueueOpen, setIsTaskQueueOpen] = useState(false);
    const [isConsistencyOpen, setIsConsistencyOpen] = useState(false);
    const [isPublishWorkflowOpen, setIsPublishWorkflowOpen] = useState(false);
    const [floatingContextPanel, setFloatingContextPanel] = useState<FloatingContextPanel>(null);
    const [aiReview, setAiReview] = useState<AIReviewState | null>(null);
    const [isReviewPending, setIsReviewPending] = useState(false);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [isPluginCenterOpen, setIsPluginCenterOpen] = useState(false);
    const [isTypographySettingsOpen, setIsTypographySettingsOpen] = useState(false);

    // Sidebar Tab State
    const [sidebarTab, setSidebarTab] = useState<'context' | 'chat' | 'history' | 'stats'>('context');

    // History State
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Selection State
    const [selectionRange, setSelectionRange] = useState<{ start: number, end: number } | null>(null);
    const [selectedText, setSelectedText] = useState('');

    const editorRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const loadNode = async () => {
            if (!activeNodeId) {
                setNode(null);
                return;
            }
            setIsLoading(true);
            try {
                const n = await db.nodes.get(activeNodeId);
                if (n) {
                    setNode(n);
                    setContent(n.content || '');

                    // Load History
                    const h = await getHistory(activeNodeId);
                    setHistory(h);
                    setHistoryIndex(h.length - 1);

                    if (n.parentId) {
                        const p = await db.nodes.get(n.parentId);
                        setParentNode(p);
                    } else {
                        setParentNode(undefined);
                    }
                }
            } catch (e) {
                console.error("Error loading node:", e);
            } finally {
                setIsLoading(false);
            }
        };
        loadNode();
        setViewMode('edit');
        setSelectionRange(null);
        setFloatingContextPanel(null);
        setAiReview(null);
        setIsReviewPending(false);
    }, [activeNodeId]);

    useEffect(() => {
        if (!floatingContextPanel) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setFloatingContextPanel(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [floatingContextPanel]);

    useEffect(() => {
        const handleGlobalShortcuts = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            const isPrimary = e.metaKey || e.ctrlKey;

            if (isPrimary && key === 'k') {
                e.preventDefault();
                setIsCommandPaletteOpen((prev) => !prev);
                return;
            }

            if (isPrimary && key === 's') {
                e.preventDefault();
                void handleManualSave('manual');
                toast.success('已保存');
                return;
            }

            if (e.altKey && key === '1') {
                e.preventDefault();
                setViewMode('edit');
            } else if (e.altKey && key === '2') {
                e.preventDefault();
                setViewMode('preview');
            } else if (e.altKey && key === '3') {
                e.preventDefault();
                setViewMode('diff');
            }
        };

        window.addEventListener('keydown', handleGlobalShortcuts);
        return () => window.removeEventListener('keydown', handleGlobalShortcuts);
    }, [content, currentBook, node, toast]);

    const handleManualSave = async (action: 'manual' | 'restore' = 'manual') => {
        if (node && content !== node.content) {
            await db.nodes.update(node.id, { content, status: content.length > 100 ? 'drafted' : 'outlined' });
            await saveHistory(node.id, content, action);

            // Update book word count
            if (currentBook) {
                await import('../db').then(mod => mod.updateBookWordCount(currentBook.id));
            }

            const h = await getHistory(node.id);
            setHistory(h);
            setHistoryIndex(h.length - 1);
        }
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setContent(history[newIndex].content);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setContent(history[newIndex].content);
        }
    };

    useEffect(() => {
        if (isGenerating || isReviewPending) return;
        const timer = setTimeout(() => handleManualSave('manual'), 2000);
        return () => clearTimeout(timer);
    }, [content, isGenerating, isReviewPending]);

    // Handle Text Selection
    const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.currentTarget;
        if (target.selectionStart !== target.selectionEnd) {
            setSelectionRange({ start: target.selectionStart, end: target.selectionEnd });
            setSelectedText(target.value.substring(target.selectionStart, target.selectionEnd));
        } else {
            setSelectionRange(null);
            setSelectedText('');
        }
    };

    const openDraftModal = () => {
        setIsDraftSettingsOpen(true);
    };

    const handleAIDraft = async (contextLimit: number) => {
        if (!node || !currentBook) return;
        setViewMode('edit');
        const originalContent = content;
        setIsReviewPending(true);
        try {
            const draft = await aiDraft(node, currentBook, (newContent) => {
                setContent(newContent);
                if (editorRef.current) {
                    editorRef.current.scrollTop = editorRef.current.scrollHeight;
                }
            }, contextLimit, { persist: false });

            if (!draft) {
                setContent(originalContent);
                setIsReviewPending(false);
                return;
            }

            setAiReview({
                mode: 'draft',
                originalContent,
                generatedContent: draft
            });
            toast.info('草稿生成完成，请确认采纳段落');
        } catch (e) {
            console.error('Draft failed', e);
            setContent(originalContent);
            setIsReviewPending(false);
            const message = e instanceof Error ? e.message : '草稿生成失败';
            toast.error(message, {
                label: "重试",
                onClick: () => handleAIDraft(contextLimit)
            });
        }
    };

    const handlePolish = async () => {
        if (!node || !currentBook || !selectionRange) return;
        const originalContent = content;
        setIsReviewPending(true);
        try {
            const preContext = content.substring(0, selectionRange.start);
            const postContext = content.substring(selectionRange.end);

            const result = await aiPolish(
                selectedText,
                preContext,
                postContext,
                currentBook,
                node.id,
                (newContent) => setContent(newContent),
                { persist: false }
            );

            if (!result) {
                setContent(originalContent);
                setIsReviewPending(false);
                return;
            }

            setAiReview({
                mode: 'polish',
                originalContent,
                generatedContent: result.polishedSegment,
                preContext,
                postContext
            });

            setSelectionRange(null);
            setSelectedText('');
            toast.info('润色完成，请确认采纳段落');
        } catch (e) {
            console.error('Polish failed', e);
            setContent(originalContent);
            setIsReviewPending(false);
            const message = e instanceof Error ? e.message : '润色失败';
            toast.error(message, {
                label: "重试",
                onClick: handlePolish
            });
        }
    };

    const handleCancelAIReview = () => {
        if (!aiReview) return;

        setContent(aiReview.originalContent);
        setAiReview(null);
        setIsReviewPending(false);
        toast.info('已放弃本次 AI 结果');
    };

    const handleApplyAIReview = async (acceptedContent: string) => {
        if (!node || !aiReview) return;
        const accepted = acceptedContent.trim();
        if (!accepted) {
            toast.warning('请至少选择一段内容');
            return;
        }

        const finalContent = aiReview.mode === 'polish'
            ? `${aiReview.preContext}${accepted}${aiReview.postContext}`
            : accepted;

        await db.nodes.update(node.id, { content: finalContent, status: finalContent.length > 100 ? 'drafted' : 'outlined' });
        await saveHistory(node.id, finalContent, aiReview.mode === 'draft' ? 'ai-draft' : 'ai-polish');
        if (currentBook) {
            await import('../db').then(mod => mod.updateBookWordCount(currentBook.id));
        }

        const h = await getHistory(node.id);
        setHistory(h);
        setHistoryIndex(h.length - 1);
        setNode({ ...node, content: finalContent, status: finalContent.length > 100 ? 'drafted' : 'outlined' });
        setContent(finalContent);
        setAiReview(null);
        setIsReviewPending(false);
        toast.success('已采纳选中段落');
    };

    // Handlers for updating sidebar summaries
    const updateNodeSummary = async (val: string) => {
        if (node) {
            setNode({ ...node, summary: val }); // Optimistic UI
            await db.nodes.update(node.id, { summary: val });
        }
    };

    const updateParentSummary = async (val: string) => {
        if (parentNode) {
            setParentNode({ ...parentNode, summary: val });
            await db.nodes.update(parentNode.id, { summary: val });
        }
    };

    const refreshActiveNode = async () => {
        if (!activeNodeId) return;
        const latestNode = await db.nodes.get(activeNodeId);
        if (!latestNode) return;
        setNode(latestNode);
        if (latestNode.parentId) {
            const latestParent = await db.nodes.get(latestNode.parentId);
            setParentNode(latestParent);
        }
    };

    const updateSceneMeta = async (patch: Partial<NonNullable<StoryNode['meta']>>) => {
        if (!node || node.type !== 'scene') return;
        const nextMeta = {
            ...(node.meta || {}),
            ...patch
        };
        setNode({ ...node, meta: nextMeta });
        await db.nodes.update(node.id, { meta: nextMeta });
    };

    if (!activeNodeId || (!node && !isLoading)) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground">
                <div className="text-center">
                    <Icons.Feather className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p>请从左侧大纲选择一个节点开始编织故事。</p>
                </div>
            </div>
        );
    }

    if (isLoading && !node) {
        return (
            <div className="flex-1 flex items-center justify-center bg-background text-muted-foreground">
                <div className="animate-pulse">加载中...</div>
            </div>
        );
    }

    if (!node) return null;

    const getNodeTypeName = (type: string) => {
        switch (type) {
            case 'volume': return '卷';
            case 'arc': return '剧情';
            case 'chapter': return '章';
            case 'scene': return '场景';
            default: return type;
        }
    };

    const getFloatingPanelTitle = () => {
        switch (floatingContextPanel) {
            case 'node-summary':
                return '节点摘要';
            case 'parent-summary':
                return '上级摘要';
            case 'scene-meta':
                return '场景元数据';
            case 'world':
                return '世界观';
            case 'characters':
                return '角色列表';
            default:
                return '';
        }
    };

    const paletteCommands: PaletteCommand[] = [
        {
            id: 'save-node',
            title: '保存当前节点',
            hint: 'Ctrl/Cmd + S',
            run: () => { void handleManualSave('manual'); }
        },
        {
            id: 'open-task-queue',
            title: '打开任务队列',
            run: () => setIsTaskQueueOpen(true)
        },
        {
            id: 'open-consistency',
            title: '打开一致性检查',
            run: () => setIsConsistencyOpen(true)
        },
        {
            id: 'open-publish-workflow',
            title: '打开发布工作流',
            run: () => setIsPublishWorkflowOpen(true)
        },
        {
            id: 'open-model-settings',
            title: '打开模型设置',
            run: () => setIsModelSettingsOpen(true)
        },
        {
            id: 'open-plugin-center',
            title: '打开插件中心',
            run: () => setIsPluginCenterOpen(true)
        },
        {
            id: 'open-typography',
            title: '打开排版设置',
            run: () => setIsTypographySettingsOpen(true)
        },
        {
            id: 'toggle-zen',
            title: isZenMode ? '退出禅模式' : '进入禅模式',
            hint: '专注写作视图',
            run: () => toggleZenMode()
        },
        {
            id: 'view-edit',
            title: '切换到编辑视图',
            hint: 'Alt + 1',
            run: () => setViewMode('edit')
        },
        {
            id: 'view-preview',
            title: '切换到预览视图',
            hint: 'Alt + 2',
            run: () => setViewMode('preview')
        },
    ];

    if (history.length > 0) {
        paletteCommands.push({
            id: 'view-diff',
            title: '切换到对比视图',
            hint: 'Alt + 3',
            run: () => setViewMode('diff')
        });
    }

    const editorTextStyle = {
        fontFamily: editorTypography.fontFamily,
        fontSize: `${editorTypography.fontSize}px`,
        lineHeight: editorTypography.lineHeight,
        letterSpacing: `${editorTypography.letterSpacing}px`,
        maxWidth: `${editorTypography.contentWidth}px`,
    };

    const previewParagraphStyle = {
        marginBottom: `${editorTypography.paragraphSpacing}em`,
        lineHeight: editorTypography.lineHeight,
        letterSpacing: `${editorTypography.letterSpacing}px`,
    };

    const renderSceneMetaEditor = (expanded: boolean) => {
        if (node.type !== 'scene') return null;

        const baseInputClass = expanded
            ? 'w-full bg-background/60 border border-border rounded px-3 py-2 text-sm text-foreground/90 focus:outline-none focus:border-cyan-500/40'
            : 'w-full bg-background/60 border border-border rounded px-2 py-1.5 text-xs text-foreground/90 focus:outline-none focus:border-cyan-500/40';

        return (
            <div className={`space-y-2 rounded-lg border border-border/60 bg-secondary/20 ${expanded ? 'p-4' : 'p-2.5'}`}>
                <input
                    value={node.meta?.pov || ''}
                    onChange={(e) => updateSceneMeta({ pov: e.target.value })}
                    placeholder="POV（视角角色）"
                    className={baseInputClass}
                />
                <div className="grid grid-cols-2 gap-2">
                    <input
                        value={node.meta?.timeTag || ''}
                        onChange={(e) => updateSceneMeta({ timeTag: e.target.value })}
                        placeholder="时间标记（如 第3天）"
                        className={baseInputClass}
                    />
                    <input
                        value={node.meta?.location || ''}
                        onChange={(e) => updateSceneMeta({ location: e.target.value })}
                        placeholder="地点"
                        className={baseInputClass}
                    />
                </div>
                <input
                    value={node.meta?.conflictType || ''}
                    onChange={(e) => updateSceneMeta({ conflictType: e.target.value })}
                    placeholder="冲突类型（内心/对抗/解谜等）"
                    className={baseInputClass}
                />
                <input
                    value={(node.meta?.participants || []).join('，')}
                    onChange={(e) =>
                        updateSceneMeta({
                            participants: e.target.value
                                .split(/[，,]/)
                                .map((name) => name.trim())
                                .filter(Boolean)
                        })
                    }
                    placeholder="出场角色（用逗号分隔）"
                    className={baseInputClass}
                />
                <input
                    value={(node.meta?.tags || []).join('，')}
                    onChange={(e) =>
                        updateSceneMeta({
                            tags: e.target.value
                                .split(/[，,]/)
                                .map((tag) => tag.trim())
                                .filter(Boolean)
                        })
                    }
                    placeholder="标签（伏笔、反转、战斗...）"
                    className={baseInputClass}
                />
            </div>
        );
    };

    const renderFloatingContextContent = () => {
        if (!floatingContextPanel) return null;

        if (floatingContextPanel === 'node-summary') {
            return (
                <textarea
                    value={node.summary}
                    onChange={(e) => updateNodeSummary(e.target.value)}
                    className="w-full h-full min-h-[460px] bg-secondary/50 border border-border focus:border-primary/50 rounded-xl p-4 text-sm text-foreground/90 leading-relaxed resize-none focus:outline-none transition-colors scrollbar-thin"
                />
            );
        }

        if (floatingContextPanel === 'parent-summary') {
            return (
                <textarea
                    value={parentNode?.summary || ''}
                    onChange={(e) => updateParentSummary(e.target.value)}
                    className="w-full h-full min-h-[460px] bg-secondary/50 border border-border focus:border-blue-500/50 rounded-xl p-4 text-sm text-foreground/90 leading-relaxed resize-none focus:outline-none transition-colors scrollbar-thin"
                />
            );
        }

        if (floatingContextPanel === 'world') {
            return (
                <div className="h-full overflow-y-auto bg-secondary/30 border border-border rounded-xl p-5 scrollbar-thin">
                    <div className="text-sm leading-8 text-foreground/90 whitespace-pre-wrap">
                        {currentBook?.worldSetting || '暂无世界观设定'}
                    </div>
                </div>
            );
        }

        if (floatingContextPanel === 'scene-meta') {
            return (
                <div className="max-w-4xl mx-auto">
                    {renderSceneMetaEditor(true)}
                </div>
            );
        }

        return (
            <div className="h-full overflow-y-auto space-y-3 scrollbar-thin">
                {(currentBook?.characters || []).map((char, i) => (
                    <div key={`${char.name}-${i}`} className="bg-secondary/30 p-4 rounded-xl border border-border/60">
                        <div className="text-sm font-bold text-foreground flex items-center justify-between">
                            <span>{char.name}</span>
                            <span className="text-xs text-muted-foreground font-medium">{char.role}</span>
                        </div>
                        <div className="text-xs text-foreground/80 mt-3 leading-6 whitespace-pre-wrap">
                            {char.description}
                        </div>
                        {char.secret && (
                            <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground leading-6 whitespace-pre-wrap">
                                秘密：{char.secret}
                            </div>
                        )}
                    </div>
                ))}
                {(currentBook?.characters || []).length === 0 && (
                    <div className="text-sm text-muted-foreground italic py-8 text-center">暂无角色信息</div>
                )}
            </div>
        );
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-background relative">
            {/* Settings Modal */}
            {currentBook && (
                <BookSettingsModal
                    book={currentBook}
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    onUpdate={(b) => setCurrentBook(b)}
                />
            )}

            <ModelSettingsModal
                isOpen={isModelSettingsOpen}
                onClose={() => setIsModelSettingsOpen(false)}
            />

            <TaskQueueModal
                isOpen={isTaskQueueOpen}
                onClose={() => setIsTaskQueueOpen(false)}
                node={node}
            />

            <ConsistencyCheckModal
                isOpen={isConsistencyOpen}
                onClose={() => setIsConsistencyOpen(false)}
            />

            {/* Header */}
            <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-card/50 backdrop-blur z-20">
                <div className="flex items-center">
                    <span className={`text-xs uppercase font-mono mr-3 px-2 py-0.5 rounded ${node.type === 'scene' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'}`}>
                        {getNodeTypeName(node.type)}
                    </span>
                    <h2 className="font-semibold text-foreground truncate max-w-[150px] md:max-w-md">{node.title}</h2>
                </div>

                <div className="flex items-center space-x-3">
                    <button
                        onClick={() => setIsCommandPaletteOpen(true)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="命令面板 (Ctrl/Cmd + K)"
                    >
                        <Icons.Search size={18} />
                    </button>

                    <button
                        onClick={() => setIsPluginCenterOpen(true)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="插件中心"
                    >
                        <Icons.Puzzle size={18} />
                    </button>

                    <button
                        onClick={() => setIsTypographySettingsOpen(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border/80 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        title="排版设置（字体、字号、行距、字距、版心宽度）"
                    >
                        <Icons.Layout size={14} />
                        <span className="hidden md:inline">排版</span>
                    </button>

                    {/* Model Settings Button */}
                    <button
                        onClick={() => setIsModelSettingsOpen(true)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="AI 模型设置"
                    >
                        <Icons.Cpu size={18} />
                    </button>

                    <button
                        onClick={() => setIsTaskQueueOpen(true)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="任务队列"
                    >
                        <Icons.Layers size={18} />
                    </button>

                    <button
                        onClick={() => setIsConsistencyOpen(true)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="一致性检查"
                    >
                        <Icons.AlertTriangle size={18} />
                    </button>

                    <button
                        onClick={() => setIsPublishWorkflowOpen(true)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="发布工作流"
                    >
                        <Icons.CheckCircle size={18} />
                    </button>

                    <div className="w-px h-4 bg-border mx-1" />

                    {/* Zen Mode Toggle */}
                    <button
                        onClick={toggleZenMode}
                        className={`p-1.5 rounded-md transition-colors ${isZenMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
                        title={isZenMode ? "退出禅模式 (Exit Zen Mode)" : "进入禅模式 (Enter Zen Mode)"}
                    >
                        {isZenMode ? <Icons.Minimize size={18} /> : <Icons.Maximize size={18} />}
                    </button>

                    {/* History Controls */}
                    <div className="flex items-center space-x-1 mr-4 border-r border-border pr-4">
                        <button
                            onClick={handleUndo}
                            disabled={historyIndex <= 0 || isGenerating}
                            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                            title="撤销 (Undo)"
                        >
                            <Icons.RotateCcw size={16} />
                        </button>
                        <button
                            onClick={handleRedo}
                            disabled={historyIndex >= history.length - 1 || isGenerating}
                            className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                            title="重做 (Redo)"
                        >
                            <Icons.RotateCw size={16} />
                        </button>
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex bg-secondary rounded-lg p-0.5 border border-border">
                        <button
                            onClick={() => setViewMode('edit')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'edit' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            编辑
                        </button>
                        <button
                            onClick={() => setViewMode('preview')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'preview' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            预览
                        </button>
                        <button
                            onClick={() => setViewMode('diff')}
                            disabled={history.length < 1}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${viewMode === 'diff' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground disabled:opacity-30'}`}
                        >
                            对比
                        </button>
                    </div>

                    {/* Polish Button (Visible only when text is selected) */}
                    {selectedText && !isGenerating && (
                        <button
                            onClick={() => handleManualSave('manual')} // Save current state before polishing
                            onMouseDown={handlePolish}
                            className="flex items-center space-x-2 text-xs bg-purple-500/10 text-purple-500 hover:bg-purple-500/20 px-3 py-1.5 rounded transition-colors animate-in fade-in zoom-in duration-200"
                        >
                            <Icons.Wand size={14} />
                            <span className="hidden md:inline">润色选中</span>
                        </button>
                    )}

                    {/* Draft / Stop Button */}
                    {node.type === 'scene' && (
                        isGenerating ? (
                            <button
                                onClick={stopGeneration}
                                className="flex items-center space-x-2 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 px-3 py-1.5 rounded transition-colors"
                            >
                                <Icons.X size={14} />
                                <span className="hidden md:inline">中止生成</span>
                            </button>
                        ) : (
                            <button
                                onClick={openDraftModal}
                                className="flex items-center space-x-2 text-xs bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 rounded transition-colors"
                            >
                                <Icons.Sparkles size={14} />
                                <span className="hidden md:inline">一键草稿</span>
                            </button>
                        )
                    )}
                </div>
            </div>

            {/* Draft Settings Modal */}
            <DraftSettingsModal
                isOpen={isDraftSettingsOpen}
                onClose={() => setIsDraftSettingsOpen(false)}
                onConfirm={handleAIDraft}
            />

            <AIReviewModal
                isOpen={Boolean(aiReview)}
                mode={aiReview?.mode || 'draft'}
                generatedContent={aiReview?.generatedContent || ''}
                onCancel={handleCancelAIReview}
                onApply={(acceptedContent) => {
                    void handleApplyAIReview(acceptedContent);
                }}
            />

            <CommandPalette
                isOpen={isCommandPaletteOpen}
                onClose={() => setIsCommandPaletteOpen(false)}
                commands={paletteCommands}
            />

            <TypographySettingsModal
                isOpen={isTypographySettingsOpen}
                onClose={() => setIsTypographySettingsOpen(false)}
            />

            <PluginCenterModal
                isOpen={isPluginCenterOpen}
                onClose={() => setIsPluginCenterOpen(false)}
                currentBook={currentBook}
                currentNode={node}
                selectedText={selectedText}
                onAfterRun={() => { void refreshActiveNode(); }}
            />

            {currentBook && (
                <PublishWorkflowModal
                    isOpen={isPublishWorkflowOpen}
                    onClose={() => setIsPublishWorkflowOpen(false)}
                    book={currentBook}
                />
            )}

            {/* Workspace Split */}
            <div className="flex-1 flex overflow-hidden">
                {/* Main Editor / Preview */}
                <div className={`flex-1 relative flex flex-col transition-all duration-700 ${isGenerating ? "shadow-[inset_0_0_100px_rgba(16,185,129,0.05)]" : ""}`}>

                    {/* Generating Visual Indicator - Top Gradient Line */}
                    <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent transition-opacity duration-500 ${isGenerating ? 'opacity-100 animate-pulse' : 'opacity-0'}`} />

                    {viewMode === 'edit' ? (
                        <textarea
                            ref={editorRef}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            onSelect={handleSelect}
                            placeholder={node.type === 'scene' ? "请在此处开始撰写正文 (支持 Markdown)..." : "此节点为结构节点。请在左侧大纲中点击闪光图标进行扩写。"}
                            className="flex-1 bg-transparent p-8 md:p-12 resize-none focus:outline-none text-foreground mx-auto w-full placeholder:text-muted-foreground scrollbar-thin selection:bg-primary/30"
                            style={editorTextStyle}
                        />
                    ) : viewMode === 'preview' ? (
                        <div className="flex-1 overflow-y-auto p-8 md:p-12 scrollbar-thin">
                            <div
                                className="mx-auto w-full prose prose-invert prose-emerald"
                                style={editorTextStyle}
                            >
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                        h1: ({ node, ...props }) => <h1 className="text-3xl font-bold text-primary mb-4" {...props} />,
                                        h2: ({ node, ...props }) => <h2 className="text-2xl font-bold text-foreground mt-8 mb-4" {...props} />,
                                        h3: ({ node, ...props }) => <h3 className="text-xl font-bold text-foreground/80 mt-6 mb-3" {...props} />,
                                        p: ({ node, ...props }) => <p className="text-foreground/90" style={previewParagraphStyle} {...props} />,
                                        blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground my-4" {...props} />,
                                    }}
                                >
                                    {content || "*暂无内容*"}
                                </ReactMarkdown>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto p-8 md:p-12 scrollbar-thin">
                            <div className="mx-auto w-full" style={editorTextStyle}>
                                <h3 className="text-zinc-500 text-sm mb-4">正在对比：当前草稿 vs 历史版本</h3>
                                <DiffViewer
                                    oldText={historyIndex >= 0 ? history[historyIndex].content : (node?.content || '')}
                                    newText={content}
                                />
                            </div>
                        </div>
                    )}
                    {/* Word Count Indicator */}
                    <div className="absolute bottom-4 right-6 text-xs text-muted-foreground font-mono bg-card/80 px-2 py-1 rounded border border-border pointer-events-none backdrop-blur z-20 transition-opacity opacity-50 hover:opacity-100">
                        {content.length} 字
                    </div>
                </div>

                {/* Context Sidebar (Right) - Hidden in Zen Mode */}
                {!isZenMode && (
                <div className="w-80 border-l border-border bg-card/50 flex flex-col h-full">
                    {/* Sidebar Tabs */}
                    <div className="flex border-b border-border">
                        <button
                            onClick={() => setSidebarTab('context')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors relative ${sidebarTab === 'context' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            上下文
                            {sidebarTab === 'context' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                        </button>
                        <button
                            onClick={() => setSidebarTab('chat')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors relative ${sidebarTab === 'chat' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            AI 助手
                            {sidebarTab === 'chat' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                        </button>
                        <button
                            onClick={() => setSidebarTab('history')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors relative ${sidebarTab === 'history' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            历史
                            {sidebarTab === 'history' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                        </button>
                        <button
                            onClick={() => setSidebarTab('stats')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors relative ${sidebarTab === 'stats' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            统计
                            {sidebarTab === 'stats' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                        </button>
                    </div>

                    {sidebarTab === 'chat' ? (
                        <ChatPanel />
                    ) : sidebarTab === 'history' ? (
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">版本历史</h3>
                            <div className="space-y-3">
                                {history.slice().reverse().map((entry, idx) => {
                                    const realIndex = history.length - 1 - idx;
                                    const isCurrent = historyIndex === realIndex;
                                    return (
                                        <div
                                            key={entry.id}
                                            onClick={() => {
                                                setHistoryIndex(realIndex);
                                                setViewMode('diff');
                                            }}
                                            className={`p-3 rounded border text-sm cursor-pointer transition-all ${
                                                isCurrent
                                                ? 'bg-primary/10 border-primary/50'
                                                : 'bg-secondary/30 border-border hover:bg-secondary/50'
                                            }`}
                                        >
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                                    entry.action === 'ai-draft' ? 'bg-purple-500/20 text-purple-500' :
                                                    entry.action === 'ai-polish' ? 'bg-orange-500/20 text-orange-500' :
                                                    entry.action === 'restore' ? 'bg-red-500/20 text-red-500' :
                                                    'bg-zinc-500/20 text-zinc-500'
                                                }`}>
                                                    {entry.action === 'ai-draft' ? 'AI生成' :
                                                     entry.action === 'ai-polish' ? 'AI润色' :
                                                     entry.action === 'restore' ? '回退' : '手动'}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(entry.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>
                                            <div className="text-xs text-muted-foreground line-clamp-2 font-serif opacity-80">
                                                {entry.content.substring(0, 100)}...
                                            </div>
                                            {isCurrent && viewMode === 'diff' && content !== entry.content && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setContent(entry.content);
                                                        handleManualSave('restore');
                                                        toast.success('已恢复到此版本');
                                                        setViewMode('edit');
                                                    }}
                                                    className="mt-2 w-full py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                                                >
                                                    恢复此版本
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                                {history.length === 0 && (
                                    <div className="text-center text-muted-foreground text-xs py-8">
                                        暂无历史记录
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : sidebarTab === 'stats' ? (
                        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
                            {currentBook && <WritingStats book={currentBook} />}
                            <AIUsagePanel />
                        </div>
                    ) : (
                        <>
                            <div className="p-4 border-b border-border flex items-center justify-between">
                                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">节点信息</h3>
                                <button
                                    onClick={() => setIsSettingsOpen(true)}
                                    title="编辑世界观与设定"
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                >
                                    <Icons.Settings size={14} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
                                <div>
                                    <h4 className="text-sm font-medium text-emerald-500 mb-2 flex items-center justify-between">
                                        <span className="flex items-center"><Icons.Layers size={12} className="mr-1" /> 节点摘要</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-zinc-600 font-normal">可编辑</span>
                                            <button
                                                onClick={() => setFloatingContextPanel('node-summary')}
                                                className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                                title="浮窗查看节点摘要"
                                            >
                                                <Icons.Maximize size={12} />
                                            </button>
                                        </div>
                                    </h4>
                                    <textarea
                                        value={node.summary}
                                        onChange={(e) => updateNodeSummary(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border focus:border-primary/50 rounded p-2 text-xs text-foreground/90 leading-relaxed min-h-[100px] resize-y focus:outline-none transition-colors scrollbar-thin"
                                    />
                                </div>

                                {parentNode && (
                                    <div>
                                        <h4 className="text-sm font-medium text-blue-500 mb-2 flex items-center justify-between">
                                            <span className="flex items-center"><Icons.ChevronDown size={12} className="mr-1" /> 上级摘要</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-zinc-600 font-normal">可编辑</span>
                                                <button
                                                    onClick={() => setFloatingContextPanel('parent-summary')}
                                                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                                    title="浮窗查看上级摘要"
                                                >
                                                    <Icons.Maximize size={12} />
                                                </button>
                                            </div>
                                        </h4>
                                        <textarea
                                            value={parentNode.summary}
                                            onChange={(e) => updateParentSummary(e.target.value)}
                                            className="w-full bg-secondary/50 border border-border focus:border-blue-500/50 rounded p-2 text-xs text-foreground/90 leading-relaxed min-h-[100px] resize-y focus:outline-none transition-colors scrollbar-thin"
                                        />
                                    </div>
                                )}

                                {node.type === 'scene' && (
                                    <div>
                                        <h4 className="text-sm font-medium text-cyan-500 mb-2 flex items-center justify-between">
                                            <span className="flex items-center">
                                                <Icons.Layout size={12} className="mr-1" /> 场景元数据
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-zinc-600 font-normal">用于看板与关系分析</span>
                                                <button
                                                    onClick={() => setFloatingContextPanel('scene-meta')}
                                                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                                    title="浮窗查看场景元数据"
                                                >
                                                    <Icons.Maximize size={12} />
                                                </button>
                                            </div>
                                        </h4>
                                        {renderSceneMetaEditor(false)}
                                    </div>
                                )}

                                <div>
                                    <h4 className="text-sm font-medium text-purple-500 mb-2 flex items-center justify-between">
                                        <span className="flex items-center">
                                            <Icons.BookOpen size={12} className="mr-1" /> 世界观 (预览)
                                        </span>
                                        <button
                                            onClick={() => setFloatingContextPanel('world')}
                                            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                            title="浮窗查看世界观"
                                        >
                                            <Icons.Maximize size={12} />
                                        </button>
                                    </h4>
                                    <div className="text-xs text-muted-foreground italic leading-relaxed max-h-32 overflow-y-auto bg-secondary/30 p-2 rounded border border-border/50 scrollbar-thin">
                                        {currentBook?.worldSetting.slice(0, 150)}...
                                        <button onClick={() => setIsSettingsOpen(true)} className="text-primary hover:underline ml-1">查看全部</button>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="text-sm font-medium text-orange-500 mb-2 flex items-center justify-between">
                                        <span className="flex items-center">
                                            <Icons.BookOpen size={12} className="mr-1" /> 角色列表
                                        </span>
                                        <button
                                            onClick={() => setFloatingContextPanel('characters')}
                                            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                            title="浮窗查看角色列表"
                                        >
                                            <Icons.Maximize size={12} />
                                        </button>
                                    </h4>
                                    <div className="space-y-2">
                                        {currentBook?.characters.map((char, i) => (
                                            <div key={i} className="bg-secondary/30 p-2 rounded border border-border/50 group hover:border-border transition-colors">
                                                <div className="text-xs font-bold text-foreground/80 flex justify-between">
                                                    {char.name}
                                                    <span className="text-muted-foreground font-normal">{char.role}</span>
                                                </div>
                                                <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{char.description}</div>
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => setIsSettingsOpen(true)}
                                            className="w-full py-1 text-xs text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/30 rounded transition-colors"
                                        >
                                            管理角色
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
                )}
            </div>

            {floatingContextPanel && (
                <div
                    className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={() => setFloatingContextPanel(null)}
                >
                    <div
                        className="w-full max-w-5xl h-[86vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
                            <h3 className="text-base font-semibold text-foreground">{getFloatingPanelTitle()}</h3>
                            <div className="flex items-center gap-2">
                                {(floatingContextPanel === 'world' || floatingContextPanel === 'characters') && (
                                    <button
                                        onClick={() => setIsSettingsOpen(true)}
                                        className="px-3 py-1.5 text-xs rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        打开设定编辑
                                    </button>
                                )}
                                <button
                                    onClick={() => setFloatingContextPanel(null)}
                                    className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                    title="关闭"
                                >
                                    <Icons.Close size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 md:p-6">
                            {renderFloatingContextContent()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
