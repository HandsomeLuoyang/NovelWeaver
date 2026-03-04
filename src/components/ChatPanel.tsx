import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useAIWriter } from '../hooks/useAIWriter';
import { chat } from '../services/geminiService';
import { db, getAncestors, getLinearContext } from '../db';
import { Icons } from './Icons';
import { ChatMessage } from '../types';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';

export const ChatPanel: React.FC = () => {
    const { currentBook, activeNodeId, chatHistory, addChatMessage, clearChatHistory } = useStore();
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const messages = (currentBook && chatHistory[currentBook.id]) || [];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || !currentBook || isSending) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now()
        };

        addChatMessage(currentBook.id, userMsg);
        setInput('');
        setIsSending(true);

        // Reset height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        const assistantMsgId = uuidv4();
        // Optimistic empty message
        const initialAssistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            timestamp: Date.now()
        };
        addChatMessage(currentBook.id, initialAssistantMsg);

        try {
            // Build context
            // In a real app, we might want to fetch the active node's content dynamically
            // For now, we'll pass a simple context string
            const context = `
            当前书名: ${currentBook.title}
            核心梗概: ${currentBook.premise}
            当前选中的节点ID: ${activeNodeId || '无'}
            `;

            // Prepare history for API
            const apiHistory = messages.map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant', // simplify for API
                content: m.content
            })) as { role: 'user' | 'assistant', content: string }[];

            apiHistory.push({ role: 'user', content: userMsg.content });

            let responseContent = "";

            await chat(apiHistory, context, (chunk) => {
                responseContent += chunk;
                // Update the last message directly in store (this might be performance heavy for large chats,
                // but fine for MVP. Alternatively, use local state for streaming and sync on finish)
                // To avoid flickering, we can update local state and sync periodically or use a specialized hook.
                // For simplicity here, let's update store.
                // Actually, updating store on every chunk triggers re-renders.
                // Let's rely on React's batching or use a local buffer.
            });

            // Re-update with full content to ensure consistency (simulated streaming update in store is tricky without direct object mutation or tailored action)
            // Let's implement a specific action `updateChatMessage` if we wanted real-time streaming visuals.
            // For this MVP, we will wait for completion or implement a hacky "stream update".

            // Since we can't easily stream into Zustand store without an action, let's just cheat and replace the last message:
            useStore.setState(state => {
                 const bookMsgs = state.chatHistory[currentBook.id] || [];
                 return {
                     chatHistory: {
                         ...state.chatHistory,
                         [currentBook.id]: bookMsgs.map(m => m.id === assistantMsgId ? { ...m, content: responseContent } : m)
                     }
                 };
            });

        } catch (error) {
            console.error("Chat failed", error);
            // Add error message
             useStore.setState(state => {
                 const bookMsgs = state.chatHistory[currentBook.id] || [];
                 return {
                     chatHistory: {
                         ...state.chatHistory,
                         [currentBook.id]: bookMsgs.map(m => m.id === assistantMsgId ? { ...m, content: "思考中断... (Error: " + error + ")" } : m)
                     }
                 };
            });
        } finally {
            setIsSending(false);
        }
    };

    // We need to implement the streaming update logic properly.
    // The above `chat` callback finishes before `setState` in the try block runs? No, `await chat`.
    // The `chat` function takes an `onStream` callback. We need to update the store inside that callback.
    // Let's rewrite handleSend to actually stream.

    const handleSendStreaming = async () => {
        if (!input.trim() || !currentBook || isSending) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: input.trim(),
            timestamp: Date.now()
        };

        addChatMessage(currentBook.id, userMsg);
        setInput('');
        setIsSending(true);

        const assistantMsgId = uuidv4();
        const initialAssistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '...',
            timestamp: Date.now()
        };
        addChatMessage(currentBook.id, initialAssistantMsg);

        let accumulatedText = "";

        try {
            // Fetch context data
            let activeNode = null;
            let linearContext = "";
            let ancestorChain = "";

            if (activeNodeId) {
                activeNode = await db.nodes.get(activeNodeId);

                // Fetch linear context (previous scenes)
                try {
                    linearContext = await getLinearContext(currentBook.id, activeNodeId, 3);
                } catch (e) {
                    console.error("Failed to fetch linear context", e);
                }

                // Fetch ancestors
                try {
                    const ancestors = await getAncestors(activeNodeId);
                    ancestorChain = ancestors.map(a => `[${a.type === 'volume' ? '卷' : a.type === 'arc' ? '剧情' : '章'}]: ${a.title}\n概要: ${a.summary}`).join('\n⬇️\n');
                } catch (e) {
                    console.error("Failed to fetch ancestors", e);
                }
            }

            const context = `
            [当前书名]: ${currentBook.title}
            [核心梗概]: ${currentBook.premise}

            [世界观设定]:
            ${currentBook.worldSetting}

            [主要角色]:
            ${currentBook.characters?.map((c: any) => `${c.name} (${c.role}): ${c.description}`).join('\n') || '暂无角色'}

            [当前状态]:
            当前节点: ${activeNode?.title || '未选择'} (${activeNode?.type || 'N/A'})
            节点概要: ${activeNode?.summary || '无'}

            [当前正文]:
            ${activeNode?.content || '(暂无内容)'}

            [剧情脉络]:
            ${ancestorChain || '无父级结构'}

            [前文回顾]:
            ${linearContext || '无前文内容'}
            `;

             // API history excludes the current new message initially? No, the chat API expects history to include previous messages.
             // The user message we just added is part of the "new" interaction.
             // Our `chat` service expects history NOT to include the very latest prompt if we treat the last argument as context,
             // BUT `geminiService.ts` implementation of `chat` takes `history` array.
             // In `geminiService.ts`: "The last message is the new prompt, remove it from history for startChat".
             // So we should pass the FULL history including the user's new message.

             const fullHistory = [
                 ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                 { role: 'user' as const, content: userMsg.content }
             ];

            await chat(fullHistory, context, (chunk) => {
                accumulatedText += chunk;
                // Direct store update for streaming effect
                useStore.setState(state => {
                    const msgs = state.chatHistory[currentBook.id] || [];
                    const newMsgs = msgs.map(m =>
                        m.id === assistantMsgId ? { ...m, content: accumulatedText } : m
                    );
                    return {
                        chatHistory: {
                            ...state.chatHistory,
                            [currentBook.id]: newMsgs
                        }
                    };
                });
            });

        } catch (e) {
            console.error(e);
            useStore.setState(state => {
                 const msgs = state.chatHistory[currentBook.id] || [];
                 return {
                     chatHistory: {
                         ...state.chatHistory,
                         [currentBook.id]: msgs.map(m => m.id === assistantMsgId ? { ...m, content: accumulatedText + "\n[出错了]" } : m)
                     }
                 };
            });
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendStreaming();
        }
    };

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/20">
                <span className="text-xs font-bold text-muted-foreground uppercase flex items-center">
                    <Icons.Sparkles size={12} className="mr-1 text-primary" />
                    AI 助手
                </span>
                <button
                    onClick={() => currentBook && clearChatHistory(currentBook.id)}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    title="清空记录"
                >
                    <Icons.Trash2 size={12} />
                </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                {messages.length === 0 && (
                    <div className="text-center text-xs text-muted-foreground mt-8">
                        <Icons.Sparkles className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        <p>有什么可以帮你的吗？<br/>试着问我剧情建议、角色名字或世界观设定。</p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`
                                max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed
                                ${msg.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-br-none'
                                    : 'bg-secondary text-secondary-foreground rounded-bl-none'}
                            `}
                        >
                            {msg.role === 'assistant' ? (
                                <div className="prose prose-invert prose-xs max-w-none">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                </div>
                            ) : (
                                msg.content
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border bg-card">
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            e.target.style.height = 'auto';
                            e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder="输入消息..."
                        rows={1}
                        className="w-full bg-secondary/50 border border-border rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none max-h-32 scrollbar-thin"
                        disabled={isSending}
                    />
                    <button
                        onClick={handleSendStreaming}
                        disabled={!input.trim() || isSending}
                        className="absolute right-2 bottom-2 p-1 text-primary hover:bg-primary/10 rounded-md disabled:opacity-30 transition-colors"
                    >
                        {isSending ? <Icons.Sparkles className="animate-spin w-4 h-4" /> : <Icons.ChevronRight className="w-4 h-4" />}
                    </button>
                </div>
            </div>
        </div>
    );
};
