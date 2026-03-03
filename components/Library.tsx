import React, { useEffect, useState, useRef } from 'react';
import { db, getBookNodes, moveBookToRecycleBin } from '../db';
import { useStore } from '../store';
import { Book, StoryNode, ExportData, HistoryEntry } from '../types';
import { genesis } from '../services/geminiService';
import { exportAsMarkdown, exportAsText, downloadFile } from '../services/exportService';
import { Icons } from './Icons';
import { v4 as uuidv4 } from 'uuid';
import { ModelSettingsModal } from './ModelSettingsModal';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from './ThemeToggle';
import { BookCard } from './BookCard';
import { SearchBar } from './SearchBar';
import { useToast } from '../hooks/useToast';
import { ManualBookModal, ManualBookPayload } from './ManualBookModal';
import { BookRecycleBinModal } from './BookRecycleBinModal';

const GENESIS_PROMPT_MAX_CHARS = 20000;

export const Library: React.FC = () => {
    const [books, setBooks] = useState<Book[]>([]);
    const [filteredBooks, setFilteredBooks] = useState<Book[]>([]);
    const [prompt, setPrompt] = useState('');
    const { setCurrentBook, setGenerating, isGenerating, generationStatus } = useStore();
    const [showModelSettings, setShowModelSettings] = useState(false);
    const [showManualCreate, setShowManualCreate] = useState(false);
    const [showRecycleBin, setShowRecycleBin] = useState(false);
    const [isCreatingManual, setIsCreatingManual] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const toast = useToast();

    const loadBooks = async () => {
        const allBooks = await db.books.orderBy('createdAt').reverse().toArray();
        setBooks(allBooks);
        setFilteredBooks(allBooks);
    };

    useEffect(() => {
        void loadBooks();
    }, [isGenerating]);

    const handleGenesis = async () => {
        if (!prompt.trim()) return;
        setGenerating(true);
        try {
            const data = await genesis(prompt);

            const newBook: Book = {
                id: uuidv4(),
                title: data.title,
                premise: data.premise,
                worldSetting: data.worldSetting,
                characters: data.characters,
                wordCount: 0,
                createdAt: Date.now()
            };

            await db.books.add(newBook);

            const volumeNodes: StoryNode[] = data.initialVolumes.map((vol, idx) => ({
                id: uuidv4(),
                bookId: newBook.id,
                parentId: null,
                type: 'volume',
                title: vol.title,
                summary: vol.summary,
                status: 'empty',
                order: idx
            }));

            await db.nodes.bulkAdd(volumeNodes);

            setBooks([newBook, ...books]);
            setPrompt('');
            setCurrentBook(newBook);
            toast.success(`《${data.title}》创建成功！`);
        } catch (e) {
            console.error(e);
            toast.error("创世失败。请检查 API Key 或网络设置。", {
                label: "重试",
                onClick: handleGenesis
            });
        } finally {
            setGenerating(false);
        }
    };

    const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleGenesis();
        }
    };

    const handleManualCreate = async (payload: ManualBookPayload) => {
        setIsCreatingManual(true);
        try {
            const sanitizedCharacters = payload.characters
                .map((char) => ({
                    name: char.name.trim(),
                    role: char.role.trim(),
                    description: char.description.trim(),
                    secret: char.secret.trim()
                }))
                .filter((char) => char.name.length > 0);

            const premise = payload.premise.trim();
            const newBook: Book = {
                id: uuidv4(),
                title: payload.title.trim(),
                premise,
                worldSetting: payload.worldSetting.trim(),
                characters: sanitizedCharacters,
                wordCount: 0,
                createdAt: Date.now()
            };

            const firstVolume: StoryNode = {
                id: uuidv4(),
                bookId: newBook.id,
                parentId: null,
                type: 'volume',
                title: payload.initialVolumeTitle.trim() || '第一卷',
                summary: payload.initialVolumeSummary.trim() || premise || '请补充本卷概要',
                status: 'empty',
                order: 0
            };

            await db.transaction('rw', db.books, db.nodes, async () => {
                await db.books.add(newBook);
                await db.nodes.add(firstVolume);
            });

            setBooks((prev) => [newBook, ...prev]);
            setFilteredBooks((prev) => [newBook, ...prev]);
            setShowManualCreate(false);
            setCurrentBook(newBook);
            toast.success(`《${newBook.title}》已添加到书库`);
        } catch (error) {
            console.error(error);
            toast.error('手动添加失败，请稍后重试');
        } finally {
            setIsCreatingManual(false);
        }
    };

    const deleteBook = async (e: React.MouseEvent, bookId: string) => {
        e.stopPropagation();
        if (confirm('确定删除这本书吗？它会先进入回收站，可稍后恢复。')) {
            await moveBookToRecycleBin(bookId);
            await loadBooks();
            toast.success('书籍已移入回收站');
        }
    };

    const handleExport = async (e: React.MouseEvent, book: Book, format: 'json' | 'markdown' | 'text' = 'json') => {
        e.stopPropagation();
        try {
            let content: string;
            let filename: string;
            let mimeType: string;

            if (format === 'markdown') {
                content = await exportAsMarkdown(book);
                filename = `${book.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.md`;
                mimeType = 'text/markdown;charset=utf-8';
            } else if (format === 'text') {
                content = await exportAsText(book);
                filename = `${book.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
                mimeType = 'text/plain;charset=utf-8';
            } else {
                // JSON export (original)
                const nodes = await getBookNodes(book.id);
                const nodeIds = nodes.map(n => n.id);
                const history = await db.history.where('nodeId').anyOf(nodeIds).toArray();

                const exportData: ExportData = {
                    version: 2,
                    book: book,
                    nodes: nodes,
                    history: history
                };

                content = JSON.stringify(exportData, null, 2);
                filename = `novelweaver_${book.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
                mimeType = 'application/json';
            }

            downloadFile(content, filename);
            toast.success(`《${book.title}》已导出为 ${format.toUpperCase()} 格式`);
        } catch (err) {
            console.error("Export failed", err);
            toast.error("导出失败，请重试");
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const text = ev.target?.result as string;
                const data: ExportData = JSON.parse(text);
                if (!data.book || !data.nodes) throw new Error("Invalid Format");

                const newBookId = uuidv4();
                const newBook: Book = {
                    ...data.book,
                    id: newBookId,
                    title: `${data.book.title} (Imported)`,
                    wordCount: data.book.wordCount || 0,
                    createdAt: Date.now()
                };

                const idMap = new Map<string, string>();
                data.nodes.forEach(node => {
                    idMap.set(node.id, uuidv4());
                });

                const newNodes: StoryNode[] = data.nodes.map(node => ({
                    ...node,
                    id: idMap.get(node.id)!,
                    bookId: newBookId,
                    parentId: node.parentId ? idMap.get(node.parentId) || null : null
                }));

                await db.books.add(newBook);
                await db.nodes.bulkAdd(newNodes);

                if (data.history && data.history.length > 0) {
                    const newHistory: HistoryEntry[] = [];
                    data.history.forEach((h) => {
                        const remappedNodeId = idMap.get(h.nodeId);
                        if (!remappedNodeId) return;

                        newHistory.push({
                            ...h,
                            id: undefined, // Let Dexie generate new IDs
                            nodeId: remappedNodeId
                        });
                    });

                    await db.history.bulkAdd(newHistory);
                }

                setBooks(prev => [newBook, ...prev]);
                toast.success('导入成功');

            } catch (err) {
                console.error(err);
                toast.error('导入失败：文件格式错误或已损坏');
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="w-full min-h-screen bg-background text-foreground flex flex-col relative overflow-y-auto transition-colors duration-500">
            <ModelSettingsModal isOpen={showModelSettings} onClose={() => setShowModelSettings(false)} />
            <BookRecycleBinModal
                isOpen={showRecycleBin}
                onClose={() => setShowRecycleBin(false)}
                onRestored={(book) => {
                    setBooks((prev) => [book, ...prev.filter((item) => item.id !== book.id)]);
                    setFilteredBooks((prev) => [book, ...prev.filter((item) => item.id !== book.id)]);
                    setCurrentBook(book);
                }}
            />
            <ManualBookModal
                isOpen={showManualCreate}
                isSubmitting={isCreatingManual}
                onClose={() => setShowManualCreate(false)}
                onConfirm={handleManualCreate}
            />
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />

            {/* Refined Background */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                {/* Elegant gradient mesh */}
                <div className="absolute top-0 left-0 w-full h-full opacity-40">
                    <div className="absolute top-[10%] left-[15%] w-[500px] h-[500px] bg-primary/20 rounded-full mix-blend-multiply blur-[128px] animate-blob" />
                    <div className="absolute top-[20%] right-[15%] w-[400px] h-[400px] bg-accent/15 rounded-full mix-blend-multiply blur-[128px] animate-blob animation-delay-2000" />
                    <div className="absolute bottom-[10%] left-[40%] w-[450px] h-[450px] bg-primary/15 rounded-full mix-blend-multiply blur-[128px] animate-blob animation-delay-4000" />
                </div>

                {/* Subtle texture overlay */}
                <div className="absolute inset-0 bg-noise opacity-[0.015]" />
            </div>

            {/* Minimal Header */}
            <motion.header
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 px-12 py-8"
            >
                <div className="max-w-[1600px] mx-auto flex items-center justify-between">
                    {/* Logo - Minimalist */}
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/20">
                                <Icons.Layers className="text-white w-5 h-5" strokeWidth={2.5} />
                            </div>
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold tracking-tight text-foreground">
                                NovelWeaver
                            </h1>
                            <p className="text-[10px] text-muted-foreground/60 tracking-[0.15em] uppercase font-medium">
                                Fractal Engine
                            </p>
                        </div>
                    </div>

                    {/* Actions - Clean */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowManualCreate(true)}
                            disabled={isGenerating || isCreatingManual}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                            <Icons.Plus size={14} />
                            手动添加
                        </button>
                        <button
                            onClick={handleImportClick}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            导入
                        </button>
                        <button
                            onClick={() => setShowRecycleBin(true)}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            回收站
                        </button>
                        <button
                            onClick={() => setShowModelSettings(true)}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            设置
                        </button>
                        <div className="w-px h-4 bg-border" />
                        <ThemeToggle />
                    </div>
                </div>
            </motion.header>

            {/* Main Content */}
            <div className="flex-1 flex flex-col items-center max-w-[1600px] mx-auto w-full px-12 relative z-10 pt-12 pb-24">

                {/* Hero Genesis Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                    className="w-full max-w-5xl mb-32"
                >
                    <AnimatePresence mode="wait">
                        {!isGenerating ? (
                            <motion.div
                                key="input"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="space-y-8"
                            >
                                {/* Title */}
                                <div className="text-center space-y-3">
                                    <h2 className="text-5xl font-light tracking-tight text-foreground">
                                        从一句话开始
                                    </h2>
                                    <p className="text-muted-foreground text-lg font-light">
                                        让 AI 将你的灵感编织成完整世界
                                    </p>
                                </div>

                                {/* Input */}
                                <div className="relative group">
                                    <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/50 to-accent/50 rounded-2xl opacity-0 group-focus-within:opacity-100 blur transition-all duration-500" />
                                    <div className="relative flex items-end gap-3 p-3 bg-card border border-border/50 rounded-2xl shadow-2xl shadow-black/5 transition-all duration-300 focus-within:border-primary/30">
                                        <textarea
                                            value={prompt}
                                            onChange={(e) => setPrompt(e.target.value.slice(0, GENESIS_PROMPT_MAX_CHARS))}
                                            placeholder="例如：一个失忆的魔法师在现代都市醒来..."
                                            className="flex-1 min-h-[160px] max-h-[55vh] resize-y bg-transparent rounded-xl px-5 py-4 text-base leading-7 text-foreground placeholder:text-muted-foreground/40 focus:outline-none font-light"
                                            onKeyDown={handlePromptKeyDown}
                                            autoFocus
                                            rows={6}
                                        />
                                        <button
                                            onClick={handleGenesis}
                                            disabled={!prompt.trim()}
                                            className="self-end px-10 py-4 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed relative overflow-hidden group/btn"
                                        >
                                            <span className="relative z-10">创世</span>
                                            <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-700" />
                                        </button>
                                    </div>
                                </div>

                                {/* Hint */}
                                <div className="text-center space-y-2">
                                    <p className="text-xs text-muted-foreground/50 font-medium tracking-wide">
                                        <kbd className="px-2 py-1 bg-muted/50 rounded text-foreground/60 font-mono text-[10px]">Enter</kbd> 换行，
                                        <kbd className="px-2 py-1 bg-muted/50 rounded text-foreground/60 font-mono text-[10px] ml-1">Ctrl/Cmd + Enter</kbd> 创世
                                    </p>
                                    <p className="text-xs text-muted-foreground/40 font-medium tracking-wide">
                                        已输入 {prompt.length.toLocaleString()} / {GENESIS_PROMPT_MAX_CHARS.toLocaleString()} 字
                                    </p>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="text-center py-20 space-y-6"
                            >
                                {/* Elegant spinner */}
                                <div className="relative w-16 h-16 mx-auto">
                                    <motion.div
                                        animate={{ rotate: 360 }}
                                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                                        className="absolute inset-0 border-2 border-primary/30 border-t-primary rounded-full"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <p className="text-2xl font-light text-foreground">
                                        编织世界中
                                    </p>
                                    <p className="text-sm text-muted-foreground/60">
                                        {generationStatus || "AI 正在构建叙事..."}
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>

                {/* Library Section */}
                {books.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.6, delay: 0.3 }}
                        className="w-full space-y-8"
                    >
                        {/* Section Header */}
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-3">
                                <Icons.Library className="w-4 h-4 text-muted-foreground" />
                                <h3 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">
                                    我的作品
                                </h3>
                            </div>
                            <div className="flex-1 h-px bg-border/30" />
                            <span className="text-xs text-muted-foreground/40 font-mono">
                                {books.length}
                            </span>
                        </div>

                        {/* Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            <AnimatePresence mode="popLayout">
                                {books.map((book, index) => (
                                    <BookCard
                                        key={book.id}
                                        book={book}
                                        index={index}
                                        onClick={() => setCurrentBook(book)}
                                        onDelete={(e) => deleteBook(e, book.id)}
                                        onExport={(e) => handleExport(e, book)}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                )}

                {/* Empty State */}
                {books.length === 0 && !isGenerating && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="text-center py-20 space-y-3"
                    >
                        <Icons.Feather className="w-12 h-12 mx-auto text-muted-foreground/20" strokeWidth={1.5} />
                        <p className="text-muted-foreground/40 text-sm font-light">
                            还没有创建任何作品
                        </p>
                    </motion.div>
                )}
            </div>
        </div>
    );
};
