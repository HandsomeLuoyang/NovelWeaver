import React from 'react';
import { Character } from '../../types';
import { Icons } from '../Icons';

interface Props {
  character: Character;
  onEdit: () => void;
  onDelete: () => void;
}

export const CharacterCard: React.FC<Props> = ({ character, onEdit, onDelete }) => {
  return (
    <div className="group relative bg-card hover:bg-secondary/40 border border-border rounded-lg p-4 transition-all hover:shadow-md">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex space-x-1">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded"
          title="编辑"
        >
          <Icons.Edit size={14} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
          title="删除"
        >
          <Icons.Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-start space-x-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
          {character.name.charAt(0)}
        </div>
        <div>
          <h3 className="font-bold text-foreground">{character.name}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border/50">
            {character.role}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {character.description}
        </p>

        {character.secret && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center text-[10px] text-orange-500 font-medium mb-1">
              <Icons.Target size={10} className="mr-1" /> 秘密 / 伏笔
            </div>
            <p className="text-[10px] text-muted-foreground/80 italic line-clamp-2">
              {character.secret}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
