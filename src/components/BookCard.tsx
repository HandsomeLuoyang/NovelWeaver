import React, { useRef } from 'react';
import { Book } from '../types';
import { Icons } from './Icons';
import { motion } from 'framer-motion';

interface BookCardProps {
    book: Book;
    onClick: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onExport: (e: React.MouseEvent, format: 'json' | 'markdown' | 'text') => void;
    index: number;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onClick, onDelete, onExport, index }) => {
    const [showExportMenu, setShowExportMenu] = React.useState(false);

    // Elegant color palette - subtle and refined
    const colorSchemes = [
        { bg: 'from-violet-500/10 to-purple-500/10', border: 'border-violet-500/20', accent: 'text-violet-400' },
        { bg: 'from-blue-500/10 to-indigo-500/10', border: 'border-blue-500/20', accent: 'text-blue-400' },
        { bg: 'from-rose-500/10 to-pink-500/10', border: 'border-rose-500/20', accent: 'text-rose-400' },
        { bg: 'from-amber-500/10 to-orange-500/10', border: 'border-amber-500/20', accent: 'text-amber-400' },
        { bg: 'from-emerald-500/10 to-teal-500/10', border: 'border-emerald-500/20', accent: 'text-emerald-400' },
        { bg: 'from-cyan-500/10 to-sky-500/10', border: 'border-cyan-500/20', accent: 'text-cyan-400' },
    ];

    const scheme = colorSchemes[book.title.length % colorSchemes.length];

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{
                duration: 0.4,
                delay: index * 0.05,
                ease: [0.22, 1, 0.36, 1]
            }}
            className="group"
        >
            <div
                onClick={onClick}
                className="relative h-full rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-0.5 flex flex-col ui-subtle-card"
            >
                {/* Gradient accent bar */}
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${scheme.bg} rounded-t-2xl opacity-60`} />

                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-foreground mb-1 line-clamp-2 group-hover:text-primary transition-colors">
                            {book.title}
                        </h3>
                        <p className="text-xs text-muted-foreground/50 font-mono">
                            {new Date(book.createdAt).toLocaleDateString('zh-CN', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                            })}
                        </p>
                    </div>

                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${scheme.bg} border ${scheme.border} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 ui-sheen`}>
                        <Icons.BookOpen className={`w-5 h-5 ${scheme.accent}`} strokeWidth={2} />
                    </div>
                </div>

                {/* Premise */}
                <p className="text-sm text-muted-foreground/70 leading-relaxed line-clamp-3 mb-6 font-light">
                    {book.premise}
                </p>

                {/* Footer */}
                <div className="mt-auto pt-4 border-t border-border/30 flex items-center justify-between">
                    {/* Stats */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                        <Icons.Feather size={12} strokeWidth={2} />
                        <span className="font-mono">{book.wordCount?.toLocaleString() || 0}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="relative">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowExportMenu(!showExportMenu);
                                }}
                                className="p-1.5 hover:bg-muted/50 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                title="导出"
                            >
                                <Icons.Download size={14} strokeWidth={2} />
                            </button>
                            {showExportMenu && (
                                <div className="absolute bottom-full right-0 mb-2 rounded-xl shadow-xl border border-border/50 bg-card py-1.5 min-w-[140px] z-50">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onExport(e, 'json');
                                            setShowExportMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
                                    >
                                        <Icons.FileJson size={14} />
                                        JSON
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onExport(e, 'markdown');
                                            setShowExportMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
                                    >
                                        <Icons.FileText size={14} />
                                        Markdown
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onExport(e, 'text');
                                            setShowExportMenu(false);
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
                                    >
                                        <Icons.File size={14} />
                                        纯文本
                                    </button>
                                </div>
                            )}
                        </div>
                        <button
                            onClick={onDelete}
                            className="p-1.5 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
                            title="删除"
                        >
                            <Icons.Trash2 size={14} strokeWidth={2} />
                        </button>
                    </div>
                </div>

                {/* Hover glow effect */}
                <div className="absolute inset-0 rounded-2xl bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
            </div>
        </motion.div>
    );
};
