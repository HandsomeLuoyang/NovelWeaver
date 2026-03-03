import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { StoryNode, Book } from '../types';
import { draftScene, polishText } from '../services/geminiService';
import { db, saveHistory, getLinearContext, getAncestors } from '../db';

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
        contextLimit: number = 5
    ) => {
        setIsGeneratingInternal(true);
        setGenerating(true);
        abortControllerRef.current = new AbortController();

        try {
            const linearContext = await getLinearContext(book.id, node.id, contextLimit);
            const ancestors = await getAncestors(node.id);

            let fullDraft = "";
            await draftScene(
                node,
                book,
                ancestors,
                linearContext,
                (chunk) => {
                    fullDraft += chunk;
                    onContentUpdate(fullDraft);
                },
                abortControllerRef.current.signal
            );

            await db.nodes.update(node.id, { content: fullDraft, status: 'drafted' });
            await saveHistory(node.id, fullDraft, 'ai-draft');
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
        onContentUpdate: (newFullContent: string) => void
    ) => {
        setIsGeneratingInternal(true);
        setGenerating(true);
        abortControllerRef.current = new AbortController();

        try {
            let polishedSegment = "";
            await polishText(
                selectedText,
                preContext,
                book,
                (chunk) => {
                    polishedSegment += chunk;
                    onContentUpdate(preContext + polishedSegment + postContext);
                },
                abortControllerRef.current.signal
            );

            const finalContent = preContext + polishedSegment + postContext;

            // Save to DB and History
            await db.nodes.update(nodeId, { content: finalContent, status: 'drafted' });
            await saveHistory(nodeId, finalContent, 'ai-polish');

            return finalContent;
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
