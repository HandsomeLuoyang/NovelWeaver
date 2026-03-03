import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { chat } from '../services/geminiService';
import { db, getAncestors, getLinearContext } from '../db';
import { Icons } from './Icons';
import { ChatMessage } from '../types';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';

export const ChatPanel: React.FC = () => {
    const {
        currentBook,
        activeNodeId,
        chatSessions,
        activeSessionId,
        addChatMessage,
        createChatSession,
        deleteChatSession,
        setActiveSessionId,
        updateSessionTitle,
        clearCurrentSession
    } = useStore();

    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
    const [editTitleInput, setEditTitleInput] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const sessions = (currentBook && chatSessions[currentBook.id]) || [];
    // Sort sessions by createdAt desc
    const sortedSessions = [...sessions].sort((a, b) => b.createdAt - a.createdAt);

    const activeSession = sessions.find(s => s.id === activeSessionId);
    const messages = activeSession ? activeSession.messages : [];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, activeSessionId, showHistory]);

    // Update title of new session after first user message if it's default
    useEffect(() => {
        if (activeSession && activeSession.messages.length === 2 && activeSession.title === '新对话') {
            // First message is user, second is assistant (loading) or response
            const firstMsg = activeSession.messages[0];
            if (firstMsg.role === 'user') {
                updateSessionTitle(currentBook!.id, activeSession.id, firstMsg.content.slice(0, 20));
            }
        }
    }, [activeSession?.messages.length]);

    const handleCreateSession = () => {
        if (!currentBook) return;
        createChatSession(currentBook.id);
        setShowHistory(false);
        // Focus input
        setTimeout(() => textareaRef.current?.focus(), 100);
    };

    const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (!currentBook) return;
        if (confirm('确定要删除这个会话吗？')) {
            deleteChatSession(currentBook.id, sessionId);
        }
    };

    const startEditingTitle = (e: React.MouseEvent, session: {id: string, title: string}) => {
        e.stopPropagation();
        setEditingTitleId(session.id);
        setEditTitleInput(session.title);
    };

    const saveTitle = (sessionId: string) => {
        if (!currentBook) return;
        if (editTitleInput.trim()) {
            updateSessionTitle(currentBook.id, sessionId, editTitleInput.trim());
        }
        setEditingTitleId(null);
    };

    const handleSendStreaming = async () => {
        if (!input.trim() || !currentBook || isSending) return;

        // If no active session, one will be created by addChatMessage
        // But for UI feedback, let's ensure we are in a valid state

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

             // Construct history from current messages
             // NOTE: addChatMessage has updated the store, so 'messages' variable (from render scope) is stale
             // relative to the async execution if we relied on it.
             // However, we can reconstruct what we need.
             // Better: Read fresh state or just append locally.

             // We need to exclude the just-added assistant placeholder from the history sent to API?
             // Usually yes.

             const currentMessages = messages; // This is from render scope, doesn't have the new messages yet?
             // Actually, since addChatMessage triggers re-render, 'messages' might be fresh if we weren't in a closure.
             // But handleSendStreaming is a closure over the render scope 'messages'.

             const fullHistory = [
                 ...currentMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                 { role: 'user' as const, content: userMsg.content }
             ];

            await chat(fullHistory, context, (chunk) => {
                accumulatedText += chunk;
                // Direct store update for streaming effect
                useStore.setState(state => {
                    const sessions = state.chatSessions[currentBook.id] || [];
                    const activeId = state.activeSessionId;

                    const updatedSessions = sessions.map(s => {
                        if (s.id === activeId) {
                            return {
                                ...s,
                                messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, content: accumulatedText } : m)
                            };
                        }
                        return s;
                    });

                    return {
                        chatSessions: {
                            ...state.chatSessions,
                            [currentBook.id]: updatedSessions
                        }
                    };
                });
            });

        } catch (e) {
            console.error(e);
            useStore.setState(state => {
                const sessions = state.chatSessions[currentBook.id] || [];
                const activeId = state.activeSessionId;

                const updatedSessions = sessions.map(s => {
                    if (s.id === activeId) {
                        return {
                            ...s,
                            messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, content: accumulatedText + "\n[出错了: " + e + "]" } : m)
                        };
                    }
                    return s;
                });

                return {
                    chatSessions: {
                        ...state.chatSessions,
                        [currentBook.id]: updatedSessions
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

    if (!currentBook) return <div className="p-4 text-muted-foreground text-center text-xs">请先选择一本书</div>;

    return (
        <div className="flex flex-col h-full bg-background relative">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/20">
                <div className="flex items-center overflow-hidden">
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className="mr-2 text-muted-foreground hover:text-foreground transition-colors"
                        title={showHistory ? "返回对话" : "历史记录"}
                    >
                        {showHistory ? <Icons.ArrowLeft size={16} /> : <Icons.Menu size={16} />}
                    </button>
                    <span className="text-xs font-bold text-foreground truncate max-w-[120px]" title={activeSession?.title}>
                        {showHistory ? '会话列表' : (activeSession?.title || '新对话')}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleCreateSession}
                        className="p-1 text-muted-foreground hover:text-primary transition-colors"
                        title="新对话"
                    >
                        <Icons.Plus size={16} />
                    </button>
                    {!showHistory && activeSession && (
                        <button
                            onClick={() => clearCurrentSession(currentBook.id)}
                            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                            title="清空当前对话"
                        >
                            <Icons.Trash2 size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden relative">

                {/* Session List View */}
                {showHistory ? (
                    <div className="absolute inset-0 overflow-y-auto p-2 space-y-2 z-10 bg-background">
                        {sortedSessions.length === 0 && (
                            <div className="text-center text-muted-foreground text-xs mt-8">
                                暂无历史会话
                            </div>
                        )}
                        {sortedSessions.map(session => (
                            <div
                                key={session.id}
                                onClick={() => {
                                    setActiveSessionId(session.id);
                                    setShowHistory(false);
                                }}
                                className={`
                                    group flex items-center justify-between p-3 rounded-lg cursor-pointer border
                                    transition-all duration-200
                                    ${activeSessionId === session.id
                                        ? 'bg-primary/10 border-primary/20 shadow-sm'
                                        : 'bg-card border-border hover:bg-muted/50'}
                                `}
                            >
                                <div className="flex-1 min-w-0 mr-2">
                                    {editingTitleId === session.id ? (
                                        <input
                                            value={editTitleInput}
                                            onChange={(e) => setEditTitleInput(e.target.value)}
                                            onBlur={() => saveTitle(session.id)}
                                            onKeyDown={(e) => e.key === 'Enter' && saveTitle(session.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            autoFocus
                                            className="w-full bg-background border border-primary rounded px-1 py-0.5 text-xs outline-none"
                                        />
                                    ) : (
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium truncate text-foreground">
                                                {session.title}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground">
                                                {new Date(session.createdAt).toLocaleString()} · {session.messages.length} 条消息
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => startEditingTitle(e, session)}
                                        className="p-1.5 text-muted-foreground hover:text-primary rounded-md hover:bg-background"
                                    >
                                        <Icons.Edit2 size={12} />
                                    </button>
                                    <button
                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                        className="p-1.5 text-muted-foreground hover:text-destructive rounded-md hover:bg-background"
                                    >
                                        <Icons.Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Chat Messages View */
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                            {(!activeSession || messages.length === 0) && (
                                <div className="text-center text-xs text-muted-foreground mt-8">
                                    <Icons.Sparkles className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                    <p>有什么可以帮你的吗？<br/>试着问我剧情建议、角色名字或世界观设定。</p>
                                </div>
                            )}

                            {messages.map((msg) => (
                                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                        className={`
                                            max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed shadow-sm
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
                    </div>
                )}
            </div>

            {/* Input Area (only visible in chat mode) */}
            {!showHistory && (
                <div className="p-3 border-t border-border bg-card z-20">
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => {
                                setInput(e.target.value);
                                e.target.style.height = 'auto';
                                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="输入消息..."
                            rows={1}
                            className="w-full bg-secondary/50 border border-border rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none max-h-32 scrollbar-thin transition-all"
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
            )}
        </div>
    );
};
