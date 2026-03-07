import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store';
import { db, getLinearContext, getAncestors, getHistory, getSemanticContext, getSceneCharacterStates, saveHistory, saveSceneCharacterStates } from '../db';
import { StoryNode, HistoryEntry, DraftGenerationSettings, SceneCharacterState, SceneTemplate } from '../types';
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
import { PromptManagerModal } from './PromptManagerModal';
import { CreativeRescueModal } from './CreativeRescueModal';
import { ForeshadowManagerModal } from './ForeshadowManagerModal';
import { GlobalSearchReplaceModal } from './GlobalSearchReplaceModal';
import { TimelineBoardModal } from './TimelineBoardModal';
import { CharacterArcBoardModal } from './CharacterArcBoardModal';
import { RewriteWorkbenchModal } from './RewriteWorkbenchModal';
import { MaterialLibraryModal } from './MaterialLibraryModal';
import { AIPreviewModal, AIPreviewSection, AIPreviewToggleState } from './AIPreviewModal';
import { buildReviewItem } from '../services/reviewInbox';
import { buildFactPromptContext } from '../services/factLibrary';
import { buildMaterialPromptContext } from '../services/materialLibrary';
import { BookCheckpointModal } from './BookCheckpointModal';
import { SceneTemplateManagerModal } from './SceneTemplateManagerModal';
import { PacingDiagnosticsModal } from './PacingDiagnosticsModal';
import { PublishPackModal } from './PublishPackModal';

type FloatingContextPanel = 'node-summary' | 'parent-summary' | 'scene-meta' | 'world' | 'characters' | null;
type AIReviewState =
    | {
        reviewItemId: string;
        mode: 'draft';
        originalContent: string;
        generatedContent: string;
    }
    | {
        reviewItemId: string;
        mode: 'polish';
        originalContent: string;
        generatedContent: string;
        preContext: string;
        postContext: string;
    };

interface RewriteDraftContext {
    sourceText: string;
    preContext: string;
    postContext: string;
}

interface ToolbarMenuPosition {
    top: number;
    left: number;
}

interface AIPreviewState {
    mode: 'draft' | 'polish';
    title: string;
    subtitle: string;
    scopeLabel: string;
    modelLabel: string;
    promptProfileLabel: string;
    sections: AIPreviewSection[];
    draftSettings?: DraftGenerationSettings;
}

export const Editor: React.FC = () => {
    const {
        activeNodeId,
        currentBook,
        setCurrentBook,
        isZenMode,
        toggleZenMode,
        editorTypography,
        editorSidebarWidth,
        setEditorSidebarWidth,
        expandedNodeIds,
        toggleNodeExpansion,
        setActiveNodeId,
        workspaceMode,
        setWorkspaceMode,
        models,
        modelConfig,
        promptProfiles,
        activePromptProfileId,
        reviewInbox,
        addReviewItem,
        updateReviewItemStatus,
        sceneTemplates,
    } = useStore();
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
    const [taskQueueInitialTab, setTaskQueueInitialTab] = useState<'queue' | 'results'>('queue');
    const [isConsistencyOpen, setIsConsistencyOpen] = useState(false);
    const [isPublishWorkflowOpen, setIsPublishWorkflowOpen] = useState(false);
    const [floatingContextPanel, setFloatingContextPanel] = useState<FloatingContextPanel>(null);
    const [aiReview, setAiReview] = useState<AIReviewState | null>(null);
    const [isReviewPending, setIsReviewPending] = useState(false);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [isPluginCenterOpen, setIsPluginCenterOpen] = useState(false);
    const [isTypographySettingsOpen, setIsTypographySettingsOpen] = useState(false);
    const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);
    const [isCreativeRescueOpen, setIsCreativeRescueOpen] = useState(false);
    const [isForeshadowOpen, setIsForeshadowOpen] = useState(false);
    const [isGlobalReplaceOpen, setIsGlobalReplaceOpen] = useState(false);
    const [isTimelineBoardOpen, setIsTimelineBoardOpen] = useState(false);
    const [isCharacterArcOpen, setIsCharacterArcOpen] = useState(false);
    const [isRewriteWorkbenchOpen, setIsRewriteWorkbenchOpen] = useState(false);
    const [rewriteContext, setRewriteContext] = useState<RewriteDraftContext | null>(null);
    const [isMaterialLibraryOpen, setIsMaterialLibraryOpen] = useState(false);
    const [isToolbarMoreOpen, setIsToolbarMoreOpen] = useState(false);
    const [toolbarMorePosition, setToolbarMorePosition] = useState<ToolbarMenuPosition>({ top: 0, left: 0 });
    const [aiPreview, setAiPreview] = useState<AIPreviewState | null>(null);
    const [characterStates, setCharacterStates] = useState<SceneCharacterState[]>([]);
    const [isCheckpointOpen, setIsCheckpointOpen] = useState(false);
    const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
    const [isPacingDiagnosticsOpen, setIsPacingDiagnosticsOpen] = useState(false);
    const [isPublishPackOpen, setIsPublishPackOpen] = useState(false);
    const [isSprintMode, setIsSprintMode] = useState(false);
    const [sprintMinutes, setSprintMinutes] = useState(25);
    const [sprintEndsAt, setSprintEndsAt] = useState<number | null>(null);
    const [sprintTick, setSprintTick] = useState(Date.now());

    // Sidebar Tab State
    const [sidebarTab, setSidebarTab] = useState<'context' | 'chat' | 'history' | 'stats'>('context');

    // History State
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Selection State
    const [selectionRange, setSelectionRange] = useState<{ start: number, end: number } | null>(null);
    const [selectedText, setSelectedText] = useState('');

    const editorRef = useRef<HTMLTextAreaElement>(null);
    const toolbarMoreButtonRef = useRef<HTMLButtonElement>(null);
    const toolbarMoreMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const loadNode = async () => {
            if (!activeNodeId) {
                setNode(null);
                setCharacterStates([]);
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

                    if (n.type === 'scene') {
                        const nextStates = await getSceneCharacterStates(n.bookId, n.id);
                        setCharacterStates(nextStates);
                    } else {
                        setCharacterStates([]);
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
        setIsCreativeRescueOpen(false);
        setIsRewriteWorkbenchOpen(false);
        setRewriteContext(null);
        setIsToolbarMoreOpen(false);
        setAiPreview(null);
    }, [activeNodeId]);

    const recalcToolbarMorePosition = () => {
        const button = toolbarMoreButtonRef.current;
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const menuWidth = 220;
        const viewportWidth = window.innerWidth;
        const left = Math.max(8, Math.min(rect.left, viewportWidth - menuWidth - 8));
        setToolbarMorePosition({
            top: rect.bottom + 8,
            left,
        });
    };

    const toggleToolbarMoreMenu = () => {
        if (!isToolbarMoreOpen) {
            recalcToolbarMorePosition();
        }
        setIsToolbarMoreOpen((prev) => !prev);
    };

    const startSidebarResize = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = editorSidebarWidth;

        const handleMove = (moveEvent: MouseEvent) => {
            const delta = startX - moveEvent.clientX;
            setEditorSidebarWidth(startWidth + delta);
        };

        const handleUp = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
    };

    useEffect(() => {
        if (!isToolbarMoreOpen) return;

        const handleOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node | null;
            const inButton = Boolean(toolbarMoreButtonRef.current && target && toolbarMoreButtonRef.current.contains(target));
            const inMenu = Boolean(toolbarMoreMenuRef.current && target && toolbarMoreMenuRef.current.contains(target));
            if (!inButton && !inMenu) {
                setIsToolbarMoreOpen(false);
            }
        };

        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsToolbarMoreOpen(false);
            }
        };

        const handleViewportChange = () => {
            recalcToolbarMorePosition();
        };

        window.addEventListener('mousedown', handleOutsideClick);
        window.addEventListener('keydown', handleEsc);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        return () => {
            window.removeEventListener('mousedown', handleOutsideClick);
            window.removeEventListener('keydown', handleEsc);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [isToolbarMoreOpen]);

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

    useEffect(() => {
        if (!sprintEndsAt) return;
        const timer = window.setInterval(() => {
            setSprintTick(Date.now());
        }, 1000);
        return () => window.clearInterval(timer);
    }, [sprintEndsAt]);

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

    const defaultPreviewToggles: AIPreviewToggleState = {
        includeHierarchyContext: true,
        includeLinearContext: true,
        includeSemanticContext: true,
        includeFactContext: true,
        includeMaterialContext: true,
        includeStyleBible: true,
    };

    const getAssignedModelLabel = (task: 'drafting' | 'polishing' | 'expansion' | 'chat' | 'genesis') => {
        const modelIdMap = {
            genesis: modelConfig.genesisModelId,
            expansion: modelConfig.expansionModelId,
            drafting: modelConfig.draftingModelId,
            polishing: modelConfig.polishingModelId,
            chat: modelConfig.chatModelId,
        };
        const modelId = modelIdMap[task];
        const model = models.find((item) => item.id === modelId);
        return model ? `${model.name} · ${model.modelName}` : '未分配模型';
    };

    const getActivePromptProfileLabel = () => {
        return promptProfiles.find((profile) => profile.id === activePromptProfileId)?.name || '默认提示词';
    };

    const buildStylePreviewText = () => {
        if (!currentBook) return '（当前未配置风格圣经）';
        const parts = [
            currentBook.writingStyle ? `写作风格：${currentBook.writingStyle}` : '',
            currentBook.styleReferences?.length ? `参考作品：${currentBook.styleReferences.join('、')}` : '',
            currentBook.styleBible?.rules ? `风格规则：\n${currentBook.styleBible.rules}` : '',
            currentBook.styleBible?.bannedTerms?.length ? `禁用词：${currentBook.styleBible.bannedTerms.join('、')}` : '',
            currentBook.styleBible?.sentencePatterns?.length ? `句式偏好：${currentBook.styleBible.sentencePatterns.join('\n')}` : '',
        ].filter(Boolean);
        return parts.length > 0 ? parts.join('\n\n') : '（当前未配置风格圣经）';
    };

    const buildDraftPreview = async (settings: DraftGenerationSettings) => {
        if (!node || !currentBook) return;
        const [ancestors, linearContext, semanticContext, facts, materials] = await Promise.all([
            getAncestors(node.id),
            getLinearContext(currentBook.id, node.id, settings.contextLimit),
            getSemanticContext(currentBook.id, node.id, `${node.title}\n${node.summary}`, 4),
            db.facts.where('bookId').equals(currentBook.id).toArray(),
            db.materials.where('bookId').equals(currentBook.id).toArray(),
        ]);
        const hierarchyContext = ancestors.length > 0
            ? ancestors.map((ancestor) => `[${ancestor.type}] ${ancestor.title}\n${ancestor.summary}`).join('\n\n')
            : '（无上级结构信息）';
        const factContext = buildFactPromptContext(facts);
        const materialContext = buildMaterialPromptContext(materials, `${node.title}\n${node.summary}\n${linearContext}`, 5);
        setAiPreview({
            mode: 'draft',
            title: 'AI 预执行面板',
            subtitle: '确认本次草稿生成会读取的上下文，再决定是否执行。',
            scopeLabel: `草稿生成 · 上下文窗口 ${settings.contextLimit} 场景`,
            modelLabel: getAssignedModelLabel('drafting'),
            promptProfileLabel: getActivePromptProfileLabel(),
            draftSettings: settings,
            sections: [
                { key: 'includeHierarchyContext', title: '上级结构', description: '卷 / 剧情 / 章节的结构信息。', content: hierarchyContext },
                { key: 'includeLinearContext', title: '线性前文', description: '当前场景前的连续正文片段。', content: linearContext || '（这是故事开篇或前文为空）' },
                { key: 'includeSemanticContext', title: '语义参考', description: '与当前节点高相关的历史片段。', content: semanticContext || '（未命中高相关片段）' },
                { key: 'includeFactContext', title: '事实约束', description: '事实库中的锁定事实与补充事实。', content: `${factContext.factHardConstraints}\n\n${factContext.factSoftContext}` },
                { key: 'includeMaterialContext', title: '素材引用', description: '根据当前节点检索到的素材片段。', content: materialContext.materialContext },
                { key: 'includeStyleBible', title: '风格圣经', description: '当前书籍的文风、禁用词与句式偏好。', content: buildStylePreviewText() },
            ],
        });
    };

    const executeDraftWithPreview = async (settings: DraftGenerationSettings, toggles: AIPreviewToggleState) => {
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
            }, settings, {
                persist: false,
                contextOverrides: {
                    hierarchyContext: toggles.includeHierarchyContext ? undefined : '（已关闭上级结构）',
                    linearContext: toggles.includeLinearContext ? undefined : '（已关闭线性前文）',
                    semanticContext: toggles.includeSemanticContext ? undefined : '（已关闭语义参考）',
                    factSummary: toggles.includeFactContext ? undefined : '',
                    factHardConstraints: toggles.includeFactContext ? undefined : '',
                    factSoftContext: toggles.includeFactContext ? undefined : '',
                    materialSummary: toggles.includeMaterialContext ? undefined : '',
                    materialContext: toggles.includeMaterialContext ? undefined : '',
                    styleBiblePrompt: toggles.includeStyleBible ? undefined : '',
                },
            });

            if (!draft) {
                setContent(originalContent);
                setIsReviewPending(false);
                return;
            }

            const reviewItem = buildReviewItem({
                type: 'draft',
                bookId: currentBook.id,
                nodeId: node.id,
                nodeTitle: node.title,
                promptProfileId: activePromptProfileId,
                source: 'direct',
                payload: {
                    kind: 'text',
                    mode: 'draft',
                    originalContent,
                    generatedContent: draft,
                },
            });
            addReviewItem(reviewItem);
            setAiReview({
                reviewItemId: reviewItem.id,
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
                onClick: () => handleAIDraft(settings)
            });
        }
    };

    const handleAIDraft = async (settings: DraftGenerationSettings) => {
        void buildDraftPreview(settings);
    };

    const buildPolishPreview = async () => {
        if (!node || !currentBook || !selectionRange) return;
        const [facts, materials] = await Promise.all([
            db.facts.where('bookId').equals(currentBook.id).toArray(),
            db.materials.where('bookId').equals(currentBook.id).toArray(),
        ]);
        const preContext = content.substring(0, selectionRange.start);
        const postContext = content.substring(selectionRange.end);
        const factContext = buildFactPromptContext(facts);
        const materialContext = buildMaterialPromptContext(materials, `${selectedText}\n${preContext.slice(-300)}\n${postContext.slice(0, 300)}`, 5);
        setAiPreview({
            mode: 'polish',
            title: 'AI 预执行面板',
            subtitle: '确认本次润色会读取的上下文，再决定是否执行。',
            scopeLabel: `润色选区 · ${selectedText.length} 字`,
            modelLabel: getAssignedModelLabel('polishing'),
            promptProfileLabel: getActivePromptProfileLabel(),
            sections: [
                { key: 'includeLinearContext', title: '局部上下文', description: '选区前后文片段，用于保证衔接。', content: `${preContext.slice(-220)}\n【待润色选区】\n${selectedText}\n${postContext.slice(0, 220)}` },
                { key: 'includeFactContext', title: '事实约束', description: '事实库中的锁定事实与补充事实。', content: `${factContext.factHardConstraints}\n\n${factContext.factSoftContext}` },
                { key: 'includeMaterialContext', title: '素材引用', description: '和当前选区最相关的素材。', content: materialContext.materialContext },
                { key: 'includeStyleBible', title: '风格圣经', description: '当前书籍的文风、禁用词与句式偏好。', content: buildStylePreviewText() },
            ],
        });
    };

    const executePolishWithPreview = async (toggles: AIPreviewToggleState) => {
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
                {
                    persist: false,
                    contextOverrides: {
                        factSummary: toggles.includeFactContext ? undefined : '',
                        factHardConstraints: toggles.includeFactContext ? undefined : '',
                        factSoftContext: toggles.includeFactContext ? undefined : '',
                        materialSummary: toggles.includeMaterialContext ? undefined : '',
                        materialContext: toggles.includeMaterialContext ? undefined : '',
                        styleBiblePrompt: toggles.includeStyleBible ? undefined : '',
                    },
                }
            );

            if (!result) {
                setContent(originalContent);
                setIsReviewPending(false);
                return;
            }

            const finalGeneratedContent = `${preContext}${result.polishedSegment}${postContext}`;
            const reviewItem = buildReviewItem({
                type: 'polish',
                bookId: currentBook.id,
                nodeId: node.id,
                nodeTitle: node.title,
                promptProfileId: activePromptProfileId,
                source: 'direct',
                payload: {
                    kind: 'text',
                    mode: 'polish',
                    originalContent,
                    generatedContent: finalGeneratedContent,
                },
            });
            addReviewItem(reviewItem);
            setAiReview({
                reviewItemId: reviewItem.id,
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

    const handlePolish = async () => {
        void buildPolishPreview();
    };

    const handleCancelAIReview = () => {
        if (!aiReview) return;

        setContent(aiReview.originalContent);
        updateReviewItemStatus(aiReview.reviewItemId, 'discarded');
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
        updateReviewItemStatus(aiReview.reviewItemId, 'applied');
        setAiReview(null);
        setIsReviewPending(false);
        toast.success('已采纳选中段落');
    };

    const handleConfirmAIPreview = (toggles: AIPreviewToggleState) => {
        const preview = aiPreview;
        setAiPreview(null);
        if (!preview) return;

        if (preview.mode === 'draft' && preview.draftSettings) {
            void executeDraftWithPreview(preview.draftSettings, toggles);
            return;
        }

        void executePolishWithPreview(toggles);
    };

    const openRewriteWorkbench = () => {
        if (!selectionRange || !selectedText.trim()) {
            toast.warning('请先选中一段文本');
            return;
        }
        const preContext = content.substring(0, selectionRange.start);
        const postContext = content.substring(selectionRange.end);
        setRewriteContext({
            sourceText: selectedText,
            preContext,
            postContext,
        });
        setIsRewriteWorkbenchOpen(true);
    };

    const handleApplyRewriteVariant = async (variant: string) => {
        if (!node || !rewriteContext) return;
        const accepted = variant.trim();
        if (!accepted) {
            toast.warning('改写内容为空，无法应用');
            return;
        }
        const finalContent = `${rewriteContext.preContext}${accepted}${rewriteContext.postContext}`;
        await db.nodes.update(node.id, {
            content: finalContent,
            status: finalContent.length > 100 ? 'drafted' : 'outlined',
        });
        await saveHistory(node.id, finalContent, 'ai-polish');
        if (currentBook) {
            await import('../db').then((mod) => mod.updateBookWordCount(currentBook.id));
        }
        const h = await getHistory(node.id);
        setHistory(h);
        setHistoryIndex(h.length - 1);
        setNode({ ...node, content: finalContent, status: finalContent.length > 100 ? 'drafted' : 'outlined' });
        setContent(finalContent);
        setSelectionRange(null);
        setSelectedText('');
        setIsRewriteWorkbenchOpen(false);
        setRewriteContext(null);
        toast.success('改写已应用');
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

    const jumpToNode = async (nodeId: string) => {
        setActiveNodeId(nodeId);
        const ancestors = await getAncestors(nodeId);
        ancestors.forEach((ancestor) => {
            if (!expandedNodeIds.includes(ancestor.id)) {
                toggleNodeExpansion(ancestor.id);
            }
        });
    };

    const insertCreativeSnippet = (text: string) => {
        if (!text.trim()) return;
        const suffix = content.trim().length === 0 ? text.trim() : `${content.trimEnd()}\n\n${text.trim()}`;
        setContent(suffix);
        setViewMode('edit');
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

    const applySceneTemplate = async (template: SceneTemplate) => {
        if (!node || node.type !== 'scene') return;
        const nextMeta = {
            ...(node.meta || {}),
            ...template.metaPreset,
            tags: Array.from(new Set([...(node.meta?.tags || []), ...(template.metaPreset.tags || [])])),
        };
        const nextSummary = node.summary?.trim()
            ? node.summary
            : template.summaryPrompt;
        setNode({ ...node, meta: nextMeta, summary: nextSummary });
        await db.nodes.update(node.id, { meta: nextMeta, summary: nextSummary });
        toast.success(`已应用模板：${template.name}`);
    };

    const updateCharacterState = async (index: number, patch: Partial<SceneCharacterState>) => {
        if (!node || node.type !== 'scene') return;
        const next = characterStates.map((state, stateIndex) => (
            stateIndex === index
                ? { ...state, ...patch, updatedAt: Date.now() }
                : state
        ));
        setCharacterStates(next);
        await saveSceneCharacterStates(node.bookId, node.id, next.map((state) => ({
            characterName: state.characterName,
            location: state.location,
            physicalState: state.physicalState,
            knowledgeState: state.knowledgeState,
            inventory: state.inventory,
            note: state.note,
        })));
    };

    const addCharacterStateRow = async () => {
        if (!node || node.type !== 'scene') return;
        const next = [
            ...characterStates,
            {
                id: `draft-${Date.now()}`,
                bookId: node.bookId,
                nodeId: node.id,
                characterName: '',
                location: node.meta?.location || '',
                physicalState: '',
                knowledgeState: '',
                inventory: '',
                note: '',
                updatedAt: Date.now(),
            },
        ];
        setCharacterStates(next);
        await saveSceneCharacterStates(node.bookId, node.id, next.map((state) => ({
            characterName: state.characterName,
            location: state.location,
            physicalState: state.physicalState,
            knowledgeState: state.knowledgeState,
            inventory: state.inventory,
            note: state.note,
        })));
    };

    const captureSelectionAsMaterial = async () => {
        if (!currentBook || !node || !selectedText.trim()) return;
        const now = Date.now();
        await db.materials.add({
            id: `${now}-${Math.random()}`,
            bookId: currentBook.id,
            type: 'snippet',
            title: `${node.title} 片段素材`,
            content: selectedText.trim(),
            tags: node.meta?.tags || [],
            linkedNodeId: node.id,
            source: '编辑器选区采集',
            createdAt: now,
            updatedAt: now,
        });
        toast.success('已将选中文本采集到素材库');
        setSelectedText('');
        setSelectionRange(null);
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

    const getFloatingPanelDescription = () => {
        switch (floatingContextPanel) {
            case 'node-summary':
                return '当前节点的核心信息，可直接编辑并实时保存。';
            case 'parent-summary':
                return '上级节点摘要，用于校准当前场景方向。';
            case 'scene-meta':
                return '场景标签信息，会用于看板与关系分析。';
            case 'world':
                return '世界观总设定，只读浏览，编辑请进入书籍设定。';
            case 'characters':
                return '角色档案速览，只读浏览，编辑请进入书籍设定。';
            default:
                return '';
        }
    };

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

    const toolbarGroupClass = 'flex shrink-0 items-center gap-1 rounded-xl px-1.5 py-1 ui-toolbar-pill';
    const toolbarLabelClass = 'px-1 text-[10px] font-semibold text-muted-foreground/90 whitespace-nowrap max-xl:hidden';
    const toolbarButtonClass = 'ui-sheen inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-background/80 transition-colors whitespace-nowrap';
    const toolbarMenuTriggerClass = 'ui-sheen inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-background/50 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-background transition-colors whitespace-nowrap';
    const toolbarMoreItemClass = 'ui-sheen w-full inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors';
    const pendingReviewCount = reviewInbox.filter((item) => item.status === 'pending' && item.bookId === currentBook?.id).length;
    const currentNodePendingReviews = reviewInbox.filter((item) => item.status === 'pending' && item.nodeId === node.id).length;
    const sprintSecondsRemaining = sprintEndsAt ? Math.max(0, Math.ceil((sprintEndsAt - sprintTick) / 1000)) : 0;
    const sprintTimeLabel = `${String(Math.floor(sprintSecondsRemaining / 60)).padStart(2, '0')}:${String(sprintSecondsRemaining % 60).padStart(2, '0')}`;

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
            run: () => {
                setTaskQueueInitialTab('queue');
                setIsTaskQueueOpen(true);
            }
        },
        {
            id: 'open-review-inbox',
            title: '打开审阅收件箱',
            hint: pendingReviewCount > 0 ? `当前 ${pendingReviewCount} 条待审` : '查看待审结果',
            run: () => {
                setTaskQueueInitialTab('results');
                setIsTaskQueueOpen(true);
            }
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
            id: 'open-prompt-manager',
            title: '打开提示词管理',
            run: () => setIsPromptManagerOpen(true)
        },
        {
            id: 'open-creative-rescue',
            title: '打开卡文急救包',
            hint: '灵感推进工具',
            run: () => setIsCreativeRescueOpen(true)
        },
        {
            id: 'open-foreshadow-manager',
            title: '打开伏笔管理器',
            hint: '埋点 / 推进 / 回收',
            run: () => setIsForeshadowOpen(true)
        },
        {
            id: 'open-global-replace',
            title: '打开全书检索替换',
            hint: '统一术语与命名',
            run: () => setIsGlobalReplaceOpen(true)
        },
        {
            id: 'open-material-library',
            title: '打开素材库',
            hint: 'RAG 素材检索注入',
            run: () => setIsMaterialLibraryOpen(true)
        },
        {
            id: 'open-rewrite-workbench',
            title: '打开改写工作台',
            hint: '三版本候选改写',
            run: () => openRewriteWorkbench()
        },
        {
            id: 'open-timeline-board',
            title: '打开时间线看板',
            hint: '场景时间轴校准',
            run: () => setIsTimelineBoardOpen(true)
        },
        {
            id: 'open-character-arc-board',
            title: '打开角色弧线看板',
            hint: '角色出场轨迹与弧线笔记',
            run: () => setIsCharacterArcOpen(true)
        },
        {
            id: 'open-checkpoints',
            title: '打开全书版本点',
            hint: '创建并比较检查点',
            run: () => setIsCheckpointOpen(true)
        },
        {
            id: 'open-pacing-diagnostics',
            title: '打开节奏诊断',
            hint: '分析拖沓和平段',
            run: () => setIsPacingDiagnosticsOpen(true)
        },
        {
            id: 'open-publish-pack',
            title: '打开连载发布包',
            hint: '导出发布文案模板',
            run: () => setIsPublishPackOpen(true)
        },
        {
            id: 'toggle-zen',
            title: isZenMode ? '退出禅模式' : '进入禅模式',
            hint: '专注写作视图',
            run: () => toggleZenMode()
        },
        {
            id: 'toggle-sprint',
            title: isSprintMode ? '结束写作冲刺' : '开始写作冲刺',
            hint: isSprintMode ? `剩余 ${sprintTimeLabel}` : `${sprintMinutes} 分钟专注`,
            run: () => {
                setIsSprintMode((prev) => !prev);
                setSprintEndsAt((prev) => prev ? null : Date.now() + sprintMinutes * 60 * 1000);
            }
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
                <div className="grid grid-cols-1 gap-2">
                    <input
                        value={node.meta?.goal || ''}
                        onChange={(e) => updateSceneMeta({ goal: e.target.value })}
                        placeholder="场景目标（主角要达成什么）"
                        className={baseInputClass}
                    />
                    <input
                        value={node.meta?.obstacle || ''}
                        onChange={(e) => updateSceneMeta({ obstacle: e.target.value })}
                        placeholder="主要阻力（谁/什么在阻止）"
                        className={baseInputClass}
                    />
                    <input
                        value={node.meta?.turn || ''}
                        onChange={(e) => updateSceneMeta({ turn: e.target.value })}
                        placeholder="场景转折（中段变化）"
                        className={baseInputClass}
                    />
                    <input
                        value={node.meta?.outcome || ''}
                        onChange={(e) => updateSceneMeta({ outcome: e.target.value })}
                        placeholder="场景结果（局势如何改变）"
                        className={baseInputClass}
                    />
                </div>
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
                <div className="h-full flex flex-col">
                    <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>实时保存</span>
                        <span>{node.summary.length} 字</span>
                    </div>
                    <textarea
                        value={node.summary}
                        onChange={(e) => updateNodeSummary(e.target.value)}
                        className="flex-1 min-h-[460px] bg-background border border-border focus:border-primary/50 rounded-xl p-4 text-sm text-foreground/90 leading-relaxed resize-none focus:outline-none transition-colors scrollbar-thin"
                    />
                </div>
            );
        }

        if (floatingContextPanel === 'parent-summary') {
            return (
                <div className="h-full flex flex-col">
                    <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>实时保存</span>
                        <span>{(parentNode?.summary || '').length} 字</span>
                    </div>
                    <textarea
                        value={parentNode?.summary || ''}
                        onChange={(e) => updateParentSummary(e.target.value)}
                        className="flex-1 min-h-[460px] bg-background border border-border focus:border-blue-500/50 rounded-xl p-4 text-sm text-foreground/90 leading-relaxed resize-none focus:outline-none transition-colors scrollbar-thin"
                    />
                </div>
            );
        }

        if (floatingContextPanel === 'world') {
            return (
                <div className="h-full overflow-y-auto space-y-3 pr-1 scrollbar-thin">
                    <div className="rounded-xl border border-border bg-background p-5">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">世界观设定</div>
                        <div className="text-sm leading-8 text-foreground/90 whitespace-pre-wrap">
                            {currentBook?.worldSetting || '暂无世界观设定'}
                        </div>
                    </div>
                </div>
            );
        }

        if (floatingContextPanel === 'scene-meta') {
            return (
                <div className="h-full overflow-y-auto pr-1 scrollbar-thin">
                    <div className="rounded-xl border border-border bg-background p-4 max-w-4xl mx-auto">
                        {renderSceneMetaEditor(true)}
                    </div>
                </div>
            );
        }

        return (
            <div className="h-full overflow-y-auto space-y-3 pr-1 scrollbar-thin">
                {(currentBook?.characters || []).map((char, i) => (
                    <div key={`${char.name}-${i}`} className="bg-background p-4 rounded-xl border border-border">
                        <div className="text-sm font-bold text-foreground flex items-center justify-between gap-2">
                            <span className="truncate">{char.name}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium whitespace-nowrap">
                                {char.role || '未设定'}
                            </span>
                        </div>
                        <div className="text-xs text-foreground/80 mt-3 leading-6 whitespace-pre-wrap">
                            {char.description}
                        </div>
                        {char.secret && (
                            <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground leading-6 whitespace-pre-wrap">
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
        <div className="flex-1 min-w-0 flex flex-col h-full bg-background relative">
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
                selectedText={selectedText}
                initialTab={taskQueueInitialTab}
            />

            <ConsistencyCheckModal
                isOpen={isConsistencyOpen}
                onClose={() => setIsConsistencyOpen(false)}
            />

            {/* Header */}
            <div className="border-b border-border/80 bg-card/65 backdrop-blur z-20">
                <div className="px-4 md:px-6 py-3">
                    <div className="mx-auto w-full max-w-[1420px] flex items-center justify-between gap-3">
                        <div className="flex items-center min-w-0">
                            <span className={`text-xs uppercase font-mono mr-3 px-2 py-0.5 rounded ${node.type === 'scene' ? 'bg-orange-500/10 text-orange-500' : 'bg-blue-500/10 text-blue-500'}`}>
                                {getNodeTypeName(node.type)}
                            </span>
                            <h2 className="font-semibold text-foreground truncate max-w-[180px] md:max-w-xl">{node.title}</h2>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground whitespace-nowrap">
                            {(isGenerating || isReviewPending) && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5">
                                    <Icons.Loader2 size={12} className="animate-spin" />
                                    AI 处理中
                                </span>
                            )}
                            <span className="hidden md:inline">命令面板：Ctrl/Cmd + K</span>
                        </div>
                    </div>
                </div>

                <div className="px-4 md:px-6 pb-3">
                    <div className="relative mx-auto w-full max-w-[1420px]">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            {[
                                { id: 'write', label: '创作' },
                                { id: 'plan', label: '规划' },
                                { id: 'review', label: '审校' },
                                { id: 'publish', label: '发布' },
                            ].map((workspace) => (
                                <button
                                    key={workspace.id}
                                    onClick={() => setWorkspaceMode(workspace.id as typeof workspaceMode)}
                                    className={`px-3 py-1.5 text-xs rounded-xl border transition-colors ${
                                        workspaceMode === workspace.id
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-border bg-secondary/20 text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {workspace.label}
                                </button>
                            ))}

                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        setTaskQueueInitialTab('results');
                                        setIsTaskQueueOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-secondary/20 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <Icons.Layers size={13} />
                                    <span>审阅收件箱</span>
                                    {pendingReviewCount > 0 && (
                                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{pendingReviewCount}</span>
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setIsSprintMode((prev) => !prev);
                                        setSprintEndsAt((prev) => prev ? null : Date.now() + sprintMinutes * 60 * 1000);
                                    }}
                                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                                        isSprintMode
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-border bg-secondary/20 text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    <Icons.Calendar size={13} />
                                    <span>{isSprintMode ? `冲刺中 ${sprintTimeLabel}` : '写作冲刺'}</span>
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto scrollbar-thin soft-scroll-x">
                            <div className="flex items-center gap-2 min-w-max pr-4">
                                <div className={toolbarGroupClass}>
                                <span className={toolbarLabelClass}>创作</span>
                                <button
                                    onClick={() => {
                                        void handleManualSave('manual');
                                        toast.success('已保存');
                                    }}
                                    className={toolbarButtonClass}
                                    title="保存当前节点 (Ctrl/Cmd + S)"
                                >
                                    <Icons.Save size={14} />
                                    <span>保存</span>
                                </button>

                                {workspaceMode === 'write' && node.type === 'scene' && (
                                    isGenerating ? (
                                        <button
                                            onClick={stopGeneration}
                                            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors whitespace-nowrap"
                                        >
                                            <Icons.X size={14} />
                                            <span>中止生成</span>
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={openDraftModal}
                                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors whitespace-nowrap"
                                            >
                                                <Icons.Sparkles size={14} />
                                                <span>一键草稿</span>
                                            </button>
                                            <button
                                                onClick={() => setIsCreativeRescueOpen(true)}
                                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-cyan-600 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors whitespace-nowrap"
                                            >
                                                <Icons.Wand size={14} />
                                                <span>卡文急救</span>
                                            </button>
                                        </>
                                    )
                                )}
                            </div>

                                {(workspaceMode === 'plan' || workspaceMode === 'review' || workspaceMode === 'publish') && (
                                    <div className={toolbarGroupClass}>
                                        <span className={toolbarLabelClass}>控制台</span>
                                        <button
                                            onClick={() => setIsCommandPaletteOpen(true)}
                                            className={toolbarButtonClass}
                                            title="命令面板 (Ctrl/Cmd + K)"
                                        >
                                            <Icons.Search size={14} />
                                            <span>命令面板</span>
                                        </button>
                                        <button
                                            onClick={() => setIsModelSettingsOpen(true)}
                                            className={toolbarButtonClass}
                                            title="AI 模型设置"
                                        >
                                            <Icons.Cpu size={14} />
                                            <span>模型中控</span>
                                        </button>
                                        <button
                                            onClick={() => setIsTaskQueueOpen(true)}
                                            className={toolbarButtonClass}
                                            title="任务队列"
                                        >
                                            <Icons.Layers size={14} />
                                            <span>任务队列</span>
                                        </button>
                                    </div>
                                )}

                                {(workspaceMode === 'review' || workspaceMode === 'publish') && (
                                    <div className={toolbarGroupClass}>
                                        <span className={toolbarLabelClass}>质检发布</span>
                                        <button
                                            onClick={() => setIsConsistencyOpen(true)}
                                            className={toolbarButtonClass}
                                            title="一致性检查"
                                        >
                                            <Icons.AlertTriangle size={14} />
                                            <span>一致性检查</span>
                                        </button>
                                        <button
                                            onClick={() => setIsPublishWorkflowOpen(true)}
                                            className={toolbarButtonClass}
                                            title="发布工作流"
                                        >
                                            <Icons.CheckCircle size={14} />
                                            <span>发布工作流</span>
                                        </button>
                                    </div>
                                )}

                            <div className={toolbarGroupClass}>
                                <button
                                    ref={toolbarMoreButtonRef}
                                    onClick={toggleToolbarMoreMenu}
                                    className={toolbarMenuTriggerClass}
                                    title="更多功能"
                                >
                                    <Icons.More size={14} />
                                    <span>更多</span>
                                </button>
                            </div>

                                {workspaceMode === 'write' && (
                                    <div className={toolbarGroupClass}>
                                        <span className={toolbarLabelClass}>编辑</span>
                                        <button
                                            onClick={() => setIsTypographySettingsOpen(true)}
                                            className={toolbarButtonClass}
                                            title="排版设置（字体、字号、行距、字距、版心宽度）"
                                        >
                                            <Icons.Layout size={14} />
                                            <span>排版</span>
                                        </button>
                                        <button
                                            onClick={toggleZenMode}
                                            className={`${toolbarButtonClass} ${isZenMode ? 'bg-primary/10 text-primary hover:text-primary' : ''}`}
                                            title={isZenMode ? "退出禅模式 (Exit Zen Mode)" : "进入禅模式 (Enter Zen Mode)"}
                                        >
                                            {isZenMode ? <Icons.Minimize size={14} /> : <Icons.Maximize size={14} />}
                                            <span>{isZenMode ? '退出禅模式' : '禅模式'}</span>
                                        </button>
                                        <button
                                            onClick={handleUndo}
                                            disabled={historyIndex <= 0 || isGenerating}
                                            className={`${toolbarButtonClass} disabled:opacity-30`}
                                            title="撤销 (Undo)"
                                        >
                                            <Icons.RotateCcw size={14} />
                                            <span>撤销</span>
                                        </button>
                                        <button
                                            onClick={handleRedo}
                                            disabled={historyIndex >= history.length - 1 || isGenerating}
                                            className={`${toolbarButtonClass} disabled:opacity-30`}
                                            title="重做 (Redo)"
                                        >
                                            <Icons.RotateCw size={14} />
                                            <span>重做</span>
                                        </button>
                                    </div>
                                )}

                            <div className={toolbarGroupClass}>
                                <span className={toolbarLabelClass}>视图</span>
                                <div className="flex bg-background/70 rounded-lg p-0.5 border border-border">
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
                            </div>
                            </div>
                        </div>
                        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card/80 to-transparent" />
                    </div>
                </div>
            </div>

            {/* Draft Settings Modal */}
            <DraftSettingsModal
                isOpen={isDraftSettingsOpen}
                onClose={() => setIsDraftSettingsOpen(false)}
                onConfirm={handleAIDraft}
            />

            <AIPreviewModal
                isOpen={Boolean(aiPreview)}
                title={aiPreview?.title || 'AI 预执行面板'}
                subtitle={aiPreview?.subtitle || ''}
                targetLabel={node ? `${getNodeTypeName(node.type)} · ${node.title}` : '未选中节点'}
                scopeLabel={aiPreview?.scopeLabel || ''}
                modelLabel={aiPreview?.modelLabel || ''}
                promptProfileLabel={aiPreview?.promptProfileLabel || ''}
                sections={aiPreview?.sections || []}
                initialToggles={defaultPreviewToggles}
                onClose={() => setAiPreview(null)}
                onConfirm={handleConfirmAIPreview}
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

            <PromptManagerModal
                isOpen={isPromptManagerOpen}
                onClose={() => setIsPromptManagerOpen(false)}
            />

            <CreativeRescueModal
                isOpen={isCreativeRescueOpen}
                onClose={() => setIsCreativeRescueOpen(false)}
                node={node}
                book={currentBook}
                onInsertSnippet={insertCreativeSnippet}
                onApplyDirectionToSummary={(text) => {
                    if (!text.trim()) return;
                    void updateNodeSummary(text.trim());
                    toast.success('已写入节点摘要');
                }}
            />

            <ForeshadowManagerModal
                isOpen={isForeshadowOpen}
                onClose={() => setIsForeshadowOpen(false)}
                book={currentBook}
                currentNode={node}
                onJumpToNode={(nodeId) => {
                    void jumpToNode(nodeId);
                    setIsForeshadowOpen(false);
                }}
            />

            <GlobalSearchReplaceModal
                isOpen={isGlobalReplaceOpen}
                onClose={() => setIsGlobalReplaceOpen(false)}
                book={currentBook}
                onJumpToNode={(nodeId) => {
                    void jumpToNode(nodeId);
                    setIsGlobalReplaceOpen(false);
                }}
            />

            <TimelineBoardModal
                isOpen={isTimelineBoardOpen}
                onClose={() => setIsTimelineBoardOpen(false)}
                book={currentBook}
                onJumpToNode={(nodeId) => {
                    void jumpToNode(nodeId);
                    setIsTimelineBoardOpen(false);
                }}
            />

            <CharacterArcBoardModal
                isOpen={isCharacterArcOpen}
                onClose={() => setIsCharacterArcOpen(false)}
                book={currentBook}
                onBookUpdate={(nextBook) => setCurrentBook(nextBook)}
                onJumpToNode={(nodeId) => {
                    void jumpToNode(nodeId);
                    setIsCharacterArcOpen(false);
                }}
            />

            <RewriteWorkbenchModal
                isOpen={isRewriteWorkbenchOpen}
                onClose={() => {
                    setIsRewriteWorkbenchOpen(false);
                    setRewriteContext(null);
                }}
                book={currentBook}
                sourceText={rewriteContext?.sourceText || ''}
                preContext={rewriteContext?.preContext || ''}
                postContext={rewriteContext?.postContext || ''}
                onApplyVariant={(variant) => {
                    void handleApplyRewriteVariant(variant);
                }}
            />

            <MaterialLibraryModal
                isOpen={isMaterialLibraryOpen}
                onClose={() => setIsMaterialLibraryOpen(false)}
                book={currentBook}
                currentNode={node}
                onJumpToNode={(nodeId) => {
                    void jumpToNode(nodeId);
                    setIsMaterialLibraryOpen(false);
                }}
            />

            <BookCheckpointModal
                isOpen={isCheckpointOpen}
                onClose={() => setIsCheckpointOpen(false)}
                bookId={currentBook?.id || null}
            />

            <SceneTemplateManagerModal
                isOpen={isTemplateManagerOpen}
                onClose={() => setIsTemplateManagerOpen(false)}
                onApplyTemplate={(template) => {
                    void applySceneTemplate(template);
                    setIsTemplateManagerOpen(false);
                }}
            />

            <PacingDiagnosticsModal
                isOpen={isPacingDiagnosticsOpen}
                onClose={() => setIsPacingDiagnosticsOpen(false)}
                book={currentBook}
                onJumpToNode={(nodeId) => {
                    void jumpToNode(nodeId);
                    setIsPacingDiagnosticsOpen(false);
                }}
            />

            <PublishPackModal
                isOpen={isPublishPackOpen}
                onClose={() => setIsPublishPackOpen(false)}
                book={currentBook}
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
                    <div className={`flex-1 min-w-0 relative flex flex-col transition-all duration-700 bg-gradient-to-b from-background/95 via-background to-background ${isGenerating ? "shadow-[inset_0_0_100px_rgba(16,185,129,0.05)]" : ""}`}>

                    {/* Generating Visual Indicator - Top Gradient Line */}
                    <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent transition-opacity duration-500 ${isGenerating ? 'opacity-100 animate-pulse' : 'opacity-0'}`} />

                    {selectedText && !isGenerating && (
                        <div className="absolute top-4 right-6 z-30 flex items-center gap-2 rounded-xl border border-border bg-card/90 backdrop-blur px-2 py-1 shadow-lg ui-rise-in">
                            <button
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    void handleManualSave('manual');
                                    void handlePolish();
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-purple-600 bg-purple-500/10 hover:bg-purple-500/20 transition-colors whitespace-nowrap"
                                title="仅润色当前选中内容"
                            >
                                <Icons.Wand size={14} />
                                <span>润色选中</span>
                            </button>
                            <button
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    openRewriteWorkbench();
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors whitespace-nowrap"
                                title="生成 3 版改写并选择应用"
                            >
                                <Icons.Edit size={14} />
                                <span>改写工作台</span>
                            </button>
                            <button
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    void captureSelectionAsMaterial();
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                                title="将选中文本保存到素材库"
                            >
                                <Icons.BookOpen size={14} />
                                <span>采集素材</span>
                            </button>
                        </div>
                    )}

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

                    {isSprintMode && (
                        <div className="absolute bottom-4 left-6 z-20 rounded-2xl border border-border bg-card/85 px-4 py-3 shadow-lg">
                            <div className="flex items-center gap-3">
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">写作冲刺</div>
                                    <div className="text-lg font-semibold text-foreground">{sprintTimeLabel}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={sprintMinutes}
                                        onChange={(event) => setSprintMinutes(Number(event.target.value))}
                                        className="rounded-lg border border-border bg-secondary/20 px-2 py-1 text-xs text-foreground"
                                    >
                                        <option value={15}>15 分钟</option>
                                        <option value={25}>25 分钟</option>
                                        <option value={45}>45 分钟</option>
                                    </select>
                                    <button
                                        onClick={() => setSprintEndsAt(Date.now() + sprintMinutes * 60 * 1000)}
                                        className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20"
                                    >
                                        重置
                                    </button>
                                    <button
                                        onClick={() => {
                                            setIsSprintMode(false);
                                            setSprintEndsAt(null);
                                        }}
                                        className="px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-foreground"
                                    >
                                        结束
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Context Sidebar (Right) */}
                <div
                    className={`shrink-0 overflow-hidden transition-[width,opacity,transform,border-color] duration-300 ease-in-out ${
                        isZenMode
                            ? 'w-0 opacity-0 translate-x-3 border-l-transparent pointer-events-none'
                            : 'w-80 opacity-100 translate-x-0 border-l border-border/80'
                    }`}
                    style={!isZenMode ? { width: `${editorSidebarWidth}px` } : undefined}
                >
                <div className="relative h-full" style={!isZenMode ? { width: `${editorSidebarWidth}px` } : undefined}>
                <div
                    className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize bg-transparent hover:bg-primary/10"
                    onMouseDown={startSidebarResize}
                />
                <div className="bg-card/55 flex flex-col h-full backdrop-blur-sm" style={{ width: `${editorSidebarWidth}px` }}>
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
                                <div className="flex items-center gap-2">
                                    {currentNodePendingReviews > 0 && (
                                        <button
                                            onClick={() => {
                                                setTaskQueueInitialTab('results');
                                                setIsTaskQueueOpen(true);
                                            }}
                                            className="px-2 py-1 rounded-full bg-primary/10 text-primary text-[10px]"
                                        >
                                            待审 {currentNodePendingReviews}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setIsSettingsOpen(true)}
                                        title="编辑世界观与设定"
                                        className="text-muted-foreground hover:text-primary transition-colors"
                                    >
                                        <Icons.Settings size={14} />
                                    </button>
                                </div>
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
                                                <button
                                                    onClick={() => setIsTemplateManagerOpen(true)}
                                                    className="px-2 py-1 rounded-md border border-border text-[10px] text-muted-foreground hover:text-foreground"
                                                >
                                                    模板 {sceneTemplates.length}
                                                </button>
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

                                {node.type === 'scene' && (
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-sm font-medium text-violet-500 flex items-center">
                                                <Icons.Users size={12} className="mr-1" /> 角色状态账本
                                            </h4>
                                            <button
                                                onClick={() => { void addCharacterStateRow(); }}
                                                className="px-2 py-1 rounded-md border border-border text-[10px] text-muted-foreground hover:text-foreground"
                                            >
                                                新增
                                            </button>
                                        </div>
                                        <div className="space-y-2">
                                            {characterStates.map((state, index) => (
                                                <div key={`${state.characterName}-${index}`} className="rounded-xl border border-border bg-secondary/15 p-3 space-y-2">
                                                    <input
                                                        value={state.characterName}
                                                        onChange={(event) => { void updateCharacterState(index, { characterName: event.target.value }); }}
                                                        placeholder="角色名"
                                                        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs"
                                                    />
                                                    <input
                                                        value={state.location}
                                                        onChange={(event) => { void updateCharacterState(index, { location: event.target.value }); }}
                                                        placeholder="地点"
                                                        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs"
                                                    />
                                                    <input
                                                        value={state.physicalState}
                                                        onChange={(event) => { void updateCharacterState(index, { physicalState: event.target.value }); }}
                                                        placeholder="身体状态"
                                                        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs"
                                                    />
                                                    <input
                                                        value={state.knowledgeState}
                                                        onChange={(event) => { void updateCharacterState(index, { knowledgeState: event.target.value }); }}
                                                        placeholder="已知信息"
                                                        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs"
                                                    />
                                                    <input
                                                        value={state.inventory}
                                                        onChange={(event) => { void updateCharacterState(index, { inventory: event.target.value }); }}
                                                        placeholder="持有物"
                                                        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs"
                                                    />
                                                    <textarea
                                                        value={state.note}
                                                        onChange={(event) => { void updateCharacterState(index, { note: event.target.value }); }}
                                                        placeholder="备注"
                                                        className="w-full min-h-[70px] rounded-lg border border-border bg-background/60 px-3 py-2 text-xs resize-y"
                                                    />
                                                </div>
                                            ))}
                                            {characterStates.length === 0 && (
                                                <div className="text-xs text-muted-foreground italic rounded-xl border border-dashed border-border p-3">
                                                    当前场景还没有角色状态记录，可手动补充位置、状态、已知信息和持有物。
                                                </div>
                                            )}
                                        </div>
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
                </div>
            </div>
        </div>

            {isToolbarMoreOpen && createPortal(
                <div
                    ref={toolbarMoreMenuRef}
                    className="fixed z-[140] w-56 rounded-xl border border-border bg-card/95 shadow-2xl backdrop-blur p-1.5 space-y-1 ui-rise-in"
                    style={{ top: `${toolbarMorePosition.top}px`, left: `${toolbarMorePosition.left}px` }}
                >
                    <button
                        onClick={() => {
                            setIsPluginCenterOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.Puzzle size={13} />
                        <span>插件中心</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsPromptManagerOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.FileText size={13} />
                        <span>提示词管理</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsForeshadowOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.Target size={13} />
                        <span>伏笔管理</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsGlobalReplaceOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.Search size={13} />
                        <span>全书替换</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsMaterialLibraryOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.BookOpen size={13} />
                        <span>素材库</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsCheckpointOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.History size={13} />
                        <span>全书版本点</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsTimelineBoardOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.Calendar size={13} />
                        <span>时间线看板</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsCharacterArcOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.Users size={13} />
                        <span>角色弧线看板</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsPacingDiagnosticsOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.BarChart3 size={13} />
                        <span>节奏诊断</span>
                    </button>
                    <button
                        onClick={() => {
                            setIsPublishPackOpen(true);
                            setIsToolbarMoreOpen(false);
                        }}
                        className={toolbarMoreItemClass}
                    >
                        <Icons.CheckCircle size={13} />
                        <span>连载发布包</span>
                    </button>
                </div>,
                document.body
            )}

            {floatingContextPanel && (
                <div
                    className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
                    onClick={() => setFloatingContextPanel(null)}
                >
                    <div
                        className="w-full max-w-5xl h-[86vh] border border-border bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col ui-rise-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border bg-card/80 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <h3 className="text-base font-semibold text-foreground">{getFloatingPanelTitle()}</h3>
                                <p className="text-xs text-muted-foreground mt-1 truncate">
                                    {getFloatingPanelDescription()}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {(floatingContextPanel === 'world' || floatingContextPanel === 'characters') && (
                                    <button
                                        onClick={() => setIsSettingsOpen(true)}
                                        className="px-3 py-1.5 text-xs rounded-md border border-border bg-secondary text-muted-foreground hover:text-foreground transition-colors"
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

                        <div className="flex-1 overflow-y-auto p-5 md:p-6 bg-background/40">
                            <div className="h-full rounded-2xl border border-border bg-card/70 p-4 md:p-5">
                                {renderFloatingContextContent()}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
