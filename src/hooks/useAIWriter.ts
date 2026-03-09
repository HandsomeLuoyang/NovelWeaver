import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { StoryNode, Book, DraftGenerationSettings } from '../types';
import { draftScene, polishText } from '../services/geminiService';
import { extractPolishedSegment } from '../services/polishUtils';
import { db, saveHistory, getLinearContext, getAncestors, getSemanticContext } from '../db';

export const useAIWriter = () => {
    const { setGenerating, setGenerationStatus } = useStore();
    const [isGenerating, setIsGeneratingInternal] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsGeneratingInternal(false);
        setGenerating(false);
        setGenerationStatus("已中止");
    }, [setGenerating, setGenerationStatus]);

const handleAIDraft = useCallback(async (
        node: StoryNode,
        book: Book,
        onContentUpdate: (content: string) => void,
        settings: DraftGenerationSettings,
        options?: {
            persist?: boolean;
            contextOverrides?: {
                hierarchyContext?: string;
                linearContext?: string;
                semanticContext?: string;
                factSummary?: string;
                factHardConstraints?: string;
                factSoftContext?: string;
                materialSummary?: string;
                materialContext?: string;
                styleBiblePrompt?: string;
            };
        }
    ) => {
        setIsGeneratingInternal(true);
        setGenerating(true);
        abortControllerRef.current = new AbortController();
        const shouldPersist = options?.persist !== false;

        try {
            const contextLimit = settings.contextLimit;
            const linearContext = await getLinearContext(book.id, node.id, contextLimit);
            const ancestors = await getAncestors(node.id);
            const semanticContext = await getSemanticContext(book.id, node.id, `${node.title}\n${node.summary}`, 3);

            const creativeModeHint = (() => {
                if (settings.creativeMode === 'divergent') return '发散模式：优先输出非常规路径与新奇联想';
                if (settings.creativeMode === 'twist') return '反转模式：优先埋设转折与信息反差';
                if (settings.creativeMode === 'conflict') return '冲突模式：优先拉高对抗与代价';
                if (settings.creativeMode === 'dialogue') return '对白模式：优先通过对话推进关系和信息';
                return '平衡模式：剧情推进与文风质量并重';
            })();

            let fullDraft = "";
            await draftScene(
                node,
                book,
                ancestors,
                linearContext,
                semanticContext,
                (chunk) => {
                    fullDraft += chunk;
                    onContentUpdate(fullDraft);
                },
                abortControllerRef.current.signal,
                {
                    creativeModeHint,
                    antiBlockHint: settings.antiBlock
                        ? '启用：若当前推进受阻，务必给出可执行行动并抛出下一轮悬念'
                        : '关闭：按常规叙事推进',
                    contextOverrides: options?.contextOverrides,
                }
            );

            if (shouldPersist) {
                await db.nodes.update(node.id, { content: fullDraft, status: 'drafted' });
                await saveHistory(node.id, fullDraft, 'ai-draft');
            }
            return fullDraft;
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log("Drafting aborted");
            } else {
                console.error("Drafting failed", error);
                throw error;
            }
        } finally {
            setIsGeneratingInternal(false);
            setGenerating(false);
            abortControllerRef.current = null;
        }
    }, [setGenerating]);

    const handleAIPolish = useCallback(async (
        selectedText: string,
        preContext: string,
        postContext: string,
        book: Book,
        nodeId: string,
        onContentUpdate: (newFullContent: string) => void,
        options?: {
            persist?: boolean;
            contextOverrides?: {
                factSummary?: string;
                factHardConstraints?: string;
                factSoftContext?: string;
                materialSummary?: string;
                materialContext?: string;
                styleBiblePrompt?: string;
            };
        }
    ) => {
        setIsGeneratingInternal(true);
        setGenerating(true);
        abortControllerRef.current = new AbortController();
        const shouldPersist = options?.persist !== false;

        try {
            let rawPolishResponse = "";
            await polishText(
                selectedText,
                preContext,
                book,
                (chunk) => {
                    rawPolishResponse += chunk;
                },
                abortControllerRef.current.signal,
                { nodeId, contextOverrides: options?.contextOverrides }
            );

            const polishedSegment = extractPolishedSegment(rawPolishResponse);
            const polishedLength = polishedSegment.trim().length;
            const selectedLength = selectedText.trim().length;

            if (!polishedLength) {
                throw new Error('润色结果为空，请重试。');
            }

            const preHint = preContext.trim().slice(-24);
            const postHint = postContext.trim().slice(0, 24);
            const seemsLikeFullScene = (
                (preHint && polishedSegment.includes(preHint))
                || (postHint && polishedSegment.includes(postHint))
            );
            const abnormalLength = selectedLength > 0 && polishedLength > Math.max(selectedLength * 2.5, selectedLength + 800);

            if (seemsLikeFullScene || abnormalLength) {
                throw new Error('润色结果疑似包含选区外内容，请缩小选区后重试。');
            }

            const finalContent = preContext + polishedSegment + postContext;
            onContentUpdate(finalContent);

            if (shouldPersist) {
                // Save to DB and History
                await db.nodes.update(nodeId, { content: finalContent, status: 'drafted' });
                await saveHistory(nodeId, finalContent, 'ai-polish');
            }

            return { finalContent, polishedSegment };
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log("Polishing aborted");
            } else {
                console.error("Polishing failed", error);
                throw error;
            }
        } finally {
            setIsGeneratingInternal(false);
            setGenerating(false);
            abortControllerRef.current = null;
        }
    }, [setGenerating]);

    return {
        isGenerating,
        stopGeneration,
        handleAIDraft,
        handleAIPolish
    };
};
