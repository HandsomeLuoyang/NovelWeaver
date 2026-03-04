import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { useStore } from '../store';
import {
    DARK_THEME_OPTIONS,
    LIGHT_THEME_OPTIONS,
    resolveThemeMode,
} from '../services/theme';

export const ThemeToggle: React.FC = () => {
    const {
        theme,
        setTheme,
        lightThemeVariant,
        darkThemeVariant,
        setLightThemeVariant,
        setDarkThemeVariant,
    } = useStore();
    const containerRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [prefersDark, setPrefersDark] = useState<boolean>(() => (
        typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ));

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
        setPrefersDark(media.matches);

        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', update);
            return () => media.removeEventListener('change', update);
        }

        media.addListener(update);
        return () => media.removeListener(update);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (containerRef.current?.contains(event.target as Node)) return;
            setIsOpen(false);
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen]);

    const resolvedMode = resolveThemeMode(theme, prefersDark);
    const currentLightLabel = useMemo(
        () => LIGHT_THEME_OPTIONS.find((option) => option.id === lightThemeVariant)?.label || lightThemeVariant,
        [lightThemeVariant]
    );
    const currentDarkLabel = useMemo(
        () => DARK_THEME_OPTIONS.find((option) => option.id === darkThemeVariant)?.label || darkThemeVariant,
        [darkThemeVariant]
    );

    const modeButtonClass = (value: 'light' | 'dark' | 'system') => (
        `px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            theme === value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
        }`
    );

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/60 border border-border text-sm text-foreground hover:border-primary/50 transition-colors"
                title="主题与配色"
            >
                <Palette className="w-4 h-4 text-primary" />
                <span>主题</span>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-[360px] rounded-2xl border border-border bg-card shadow-2xl p-4 z-40 space-y-4">
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">显示模式</p>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setTheme('light')} className={modeButtonClass('light')}>
                                <span className="inline-flex items-center gap-1">
                                    <Sun className="w-3.5 h-3.5" />
                                    日间
                                </span>
                            </button>
                            <button type="button" onClick={() => setTheme('dark')} className={modeButtonClass('dark')}>
                                <span className="inline-flex items-center gap-1">
                                    <Moon className="w-3.5 h-3.5" />
                                    夜间
                                </span>
                            </button>
                            <button type="button" onClick={() => setTheme('system')} className={modeButtonClass('system')}>
                                <span className="inline-flex items-center gap-1">
                                    <Monitor className="w-3.5 h-3.5" />
                                    跟随系统
                                </span>
                            </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            当前生效：{resolvedMode === 'dark' ? '夜间' : '日间'}（{resolvedMode === 'dark' ? currentDarkLabel : currentLightLabel}）
                        </p>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">日间配色</p>
                        <div className="grid grid-cols-1 gap-2">
                            {LIGHT_THEME_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setLightThemeVariant(option.id)}
                                    className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                                        lightThemeVariant === option.id
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border hover:border-primary/40'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-foreground">{option.label}</p>
                                            <p className="text-xs text-muted-foreground">{option.description}</p>
                                        </div>
                                        {lightThemeVariant === option.id && <Check className="w-4 h-4 text-primary" />}
                                    </div>
                                    <div className="mt-2 flex items-center gap-1.5">
                                        {option.preview.map((value) => (
                                            <span
                                                key={value}
                                                className="inline-block w-4 h-4 rounded-full border border-black/10 dark:border-white/15"
                                                style={{ backgroundColor: `hsl(${value})` }}
                                            />
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">夜间配色</p>
                        <div className="grid grid-cols-1 gap-2">
                            {DARK_THEME_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setDarkThemeVariant(option.id)}
                                    className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                                        darkThemeVariant === option.id
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border hover:border-primary/40'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-medium text-foreground">{option.label}</p>
                                            <p className="text-xs text-muted-foreground">{option.description}</p>
                                        </div>
                                        {darkThemeVariant === option.id && <Check className="w-4 h-4 text-primary" />}
                                    </div>
                                    <div className="mt-2 flex items-center gap-1.5">
                                        {option.preview.map((value) => (
                                            <span
                                                key={value}
                                                className="inline-block w-4 h-4 rounded-full border border-black/10 dark:border-white/15"
                                                style={{ backgroundColor: `hsl(${value})` }}
                                            />
                                        ))}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
