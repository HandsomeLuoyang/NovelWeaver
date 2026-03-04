import React from 'react';
import * as Diff from 'diff';

interface DiffViewerProps {
    oldText: string;
    newText: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ oldText, newText }) => {
    const differences = Diff.diffWordsWithSpace(oldText, newText);

    return (
        <div className="font-serif text-lg leading-relaxed whitespace-pre-wrap p-4 bg-muted/50 rounded-lg border border-border">
            {differences.map((part, index) => {
                const color = part.added
                    ? 'bg-primary/20 text-primary-foreground dark:text-primary'
                    : part.removed
                        ? 'bg-destructive/20 text-destructive line-through'
                        : 'text-foreground/90';

                return (
                    <span key={index} className={color}>
                        {part.value}
                    </span>
                );
            })}
        </div>
    );
};
