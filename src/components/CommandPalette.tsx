import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons } from './Icons';

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, commands }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => {
      const haystack = `${command.title} ${command.hint || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
  }, [isOpen]);

  if (!isOpen) return null;

  const runCommand = (command: PaletteCommand) => {
    command.run();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl border border-border bg-card rounded-2xl shadow-2xl overflow-hidden ui-rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/80">
          <Icons.Search size={14} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((prev) => Math.max(prev - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const command = filtered[activeIndex];
                if (command) runCommand(command);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="输入命令，例如：打开任务队列、切换预览、禅模式..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            autoFocus
          />
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={14} />
          </button>
        </div>

        <div className="max-h-[48vh] overflow-y-auto p-2 scrollbar-thin">
          {filtered.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8">没有匹配命令</div>
          )}

          {filtered.map((command, index) => (
            <button
              key={command.id}
              onClick={() => runCommand(command)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                index === activeIndex
                  ? 'bg-primary/10 border border-primary/30 text-foreground'
                  : 'hover:bg-secondary/50 text-foreground/90 border border-transparent'
              }`}
            >
              <div className="text-sm font-medium">{command.title}</div>
              {command.hint && <div className="text-[11px] text-muted-foreground mt-0.5">{command.hint}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
