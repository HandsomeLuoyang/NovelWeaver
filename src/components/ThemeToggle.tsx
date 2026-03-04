import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useStore } from '../store';
import { motion } from 'framer-motion';

export const ThemeToggle: React.FC = () => {
    const { theme, setTheme } = useStore();

    return (
        <div className="flex items-center space-x-1 bg-secondary/50 p-1 rounded-full border border-border">
            <button
                onClick={() => setTheme('light')}
                className={`p-1.5 rounded-full transition-all ${theme === 'light'
                        ? 'bg-background shadow-sm text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                title="Light Mode"
            >
                <Sun className="w-4 h-4" />
            </button>
            <button
                onClick={() => setTheme('dark')}
                className={`p-1.5 rounded-full transition-all ${theme === 'dark'
                        ? 'bg-background shadow-sm text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                title="Dark Mode"
            >
                <Moon className="w-4 h-4" />
            </button>
            <button
                onClick={() => setTheme('system')}
                className={`p-1.5 rounded-full transition-all ${theme === 'system'
                        ? 'bg-background shadow-sm text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                title="System"
            >
                <Monitor className="w-4 h-4" />
            </button>
        </div>
    );
};
