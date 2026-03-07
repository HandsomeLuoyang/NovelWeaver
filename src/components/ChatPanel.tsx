import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../store';
import { chat } from '../services/geminiService';
import { db, getAncestors, getLinearContext } from '../db';
import { Icons } from './Icons';
import { ChatMessage } from '../types';
import { buildProjectQaContext } from '../services/projectQaService';

type ChatMode = 'assistant' | 'project';

export const ChatPanel: React.FC = () => {
    const { currentBook, activeNodeId, chatHistory, addChatMessage, clearChatHistory } = useStore();
    const [mode, setMode] = useState<ChatMode>('assistant');
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const messages = (currentBook && chatHistory[currentBook.id]) || [];

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const resetComposerHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const buildAssistantContext = async () => {
        if (!currentBook) {
            return '当前没有打开的书籍。';
        }

        let activeNode = null;
        let linearContext = '';
        let ancestorChain = '';

        if (activeNodeId) {
            activeNode = await db.nodes.get(activeNodeId);
            try {
                linearContext = await getLinearContext(currentBook.id, activeNodeId, 3);
            } catch (error) {
                console.error('Failed to fetch linear context', error);
            }
            try {
                const ancestors = await getAncestors(activeNodeId);
                ancestorChain = ancestors
                    .map((ancestor) => `[${ancestor.type === 'volume' ? '卷' : ancestor.type === 'arc' ? '剧情' : '章'}] ${ancestor.title}\n概要: ${ancestor.summary}`)
                    .join('\n⬇️\n');
            } catch (error) {
                console.error('Failed to fetch ancestors', error);
            }
        }

        return `
[当前书名]
${currentBook.title}

[核心梗概]
${currentBook.premise}

[世界观设定]
${currentBook.worldSetting}

[主要角色]
${currentBook.characters?.map((character) => `${character.name} (${character.role}): ${character.description}`).join('\n') || '暂无角色'}

[当前节点]
${activeNode?.title || '未选择'} (${activeNode?.type || 'N/A'})
摘要: ${activeNode?.summary || '无'}

[当前正文]
${activeNode?.content || '(暂无内容)'}

[剧情脉络]
${ancestorChain || '无父级结构'}

[前文回顾]
${linearContext || '无前文内容'}
`.trim();
    };

    const updateAssistantMessage = (bookId: string, assistantMsgId: string, content: string) => {
        useStore.setState((state) => {
            const bookMsgs = state.chatHistory[bookId] || [];
            return {
                chatHistory: {
                    ...state.chatHistory,
                    [bookId]: bookMsgs.map((message) => (
                        message.id === assistantMsgId ? { ...message, content } : message
                    )),
                },
            };
        });
    };

    const handleSend = async () => {
        if (!input.trim() || !currentBook || isSending) return;

        const prompt = input.trim();
        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
        };

        addChatMessage(currentBook.id, userMsg);
        setInput('');
        setIsSending(true);
        resetComposerHeight();

        const assistantMsgId = uuidv4();
        addChatMessage(currentBook.id, {
            id: assistantMsgId,
            role: 'assistant',
            content: '...',
            timestamp: Date.now(),
        });

        let accumulatedText = '';

        try {
            const history = [
                ...messages.map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content })),
                { role: 'user' as const, content: prompt },
            ];

            const { context, sources } = mode === 'project'
                ? await buildProjectQaContext(currentBook, prompt, activeNodeId)
                : { context: await buildAssistantContext(), sources: [] };

            await chat(history, context, (chunk) => {
                accumulatedText += chunk;
                updateAssistantMessage(currentBook.id, assistantMsgId, accumulatedText);
            });

            if (mode === 'project' && sources.length > 0) {
                const citationBlock = `\n\n引用来源：\n${sources
                    .slice(0, 8)
                    .map((source) => `- ${source.label}${source.nodeId ? `（节点 ${source.nodeId}）` : ''}`)
                    .join('\n')}`;
                accumulatedText += citationBlock;
                updateAssistantMessage(currentBook.id, assistantMsgId, accumulatedText);
            }
        } catch (error) {
            console.error('Chat failed', error);
            const message = accumulatedText || (mode === 'project' ? '问项目失败。' : 'AI 助手响应失败。');
            updateAssistantMessage(currentBook.id, assistantMsgId, `${message}\n\n[出错了]`);
        } finally {
            setIsSending(false);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
        }
    };

    const placeholder = mode === 'project'
        ? '问项目：角色第一次受伤在哪章？某条规则在哪些场景提过？'
        : '输入消息...';

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="border-b border-border bg-muted/20">
                <div className="flex items-center justify-between p-3">
                    <span className="text-xs font-bold text-muted-foreground uppercase flex items-center">
                        <Icons.Sparkles size={12} className="mr-1 text-primary" />
                        {mode === 'project' ? '问项目' : 'AI 助手'}
                    </span>
                    <button
                        onClick={() => currentBook && clearChatHistory(currentBook.id)}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                        title="清空记录"
                    >
                        <Icons.Trash2 size={12} />
                    </button>
                </div>
                <div className="px-3 pb-3 flex gap-2">
                    <button
                        onClick={() => setMode('assistant')}
                        className={`px-3 py-1.5 text-xs rounded-lg border ${mode === 'assistant' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                    >
                        普通助手
                    </button>
                    <button
                        onClick={() => setMode('project')}
                        className={`px-3 py-1.5 text-xs rounded-lg border ${mode === 'project' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                    >
                        问项目
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                {messages.length === 0 && (
                    <div className="text-center text-xs text-muted-foreground mt-8">
                        <Icons.Sparkles className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        <p>
                            {mode === 'project'
                                ? '试着直接问设定、角色、剧情节点，我会优先基于当前项目资料回答。'
                                : '可以问剧情建议、角色塑造、世界观设定或创作思路。'}
                        </p>
                    </div>
                )}

                {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`max-w-[88%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                                message.role === 'user'
                                    ? 'bg-primary text-primary-foreground rounded-br-none'
                                    : 'bg-secondary text-secondary-foreground rounded-bl-none'
                            }`}
                        >
                            {message.role === 'assistant' ? (
                                <div className="prose prose-invert prose-xs max-w-none">
                                    <ReactMarkdown>{message.content}</ReactMarkdown>
                                </div>
                            ) : (
                                message.content
                            )}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-border bg-card">
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(event) => {
                            setInput(event.target.value);
                            event.target.style.height = 'auto';
                            event.target.style.height = `${event.target.scrollHeight}px`;
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        rows={1}
                        className="w-full bg-secondary/50 border border-border rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none max-h-32 scrollbar-thin"
                        disabled={isSending}
                    />
                    <button
                        onClick={() => { void handleSend(); }}
                        disabled={!input.trim() || isSending}
                        className="absolute right-2 bottom-2 p-1 text-primary hover:bg-primary/10 rounded-md disabled:opacity-30 transition-colors"
                    >
                        {isSending ? <Icons.Loader2 size={16} className="animate-spin" /> : <Icons.Sparkles size={16} />}
                    </button>
                </div>
            </div>
        </div>
    );
};
