import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { createPortal } from 'react-dom';
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
    const panelRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [prefersDark, setPrefersDark] = useState<boolean>(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });
    const [panelPosition, setPanelPosition] = useState<{ top: number; left: number; width: number }>({
        top: 0,
        left: 0,
        width: 360,
    });

    const updatePanelPosition = () => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const width = 360;
        const viewportPadding = 12;
        const proposedLeft = rect.right - width;
        const minLeft = viewportPadding;
        const maxLeft = window.innerWidth - width - viewportPadding;
        const left = Math.max(minLeft, Math.min(proposedLeft, maxLeft));
        const top = rect.bottom + 8;
        setPanelPosition({ top, left, width });
    };

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
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

        updatePanelPosition();

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (containerRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;
            setIsOpen(false);
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        const handleLayout = () => updatePanelPosition();

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        window.addEventListener('resize', handleLayout);
        window.addEventListener('scroll', handleLayout, true);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
            window.removeEventListener('resize', handleLayout);
            window.removeEventListener('scroll', handleLayout, true);
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
                ref={triggerRef}
                onClick={() => setIsOpen((open) => !open)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/60 border border-border text-sm text-foreground hover:border-primary/50 transition-colors"
                title="主题与配色"
            >
                <Palette className="w-4 h-4 text-primary" />
                <span>主题</span>
            </button>

            {isOpen && typeof document !== 'undefined' && createPortal(
                <div
                    ref={panelRef}
                    className="fixed rounded-2xl border border-border bg-card shadow-2xl p-4 z-[1000] space-y-4"
                    style={{ top: panelPosition.top, left: panelPosition.left, width: panelPosition.width }}
                >
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
                </div>,
                document.body
            )}
        </div>
    );
};
