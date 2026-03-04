import React, { useState } from 'react';
import { Character } from '../../types';
import { CharacterCard } from './CharacterCard';
import { CharacterForm } from './CharacterForm';
import { Icons } from '../Icons';

interface Props {
  characters: Character[];
  onChange: (chars: Character[]) => void;
}

export const CharacterList: React.FC<Props> = ({ characters, onChange }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleAdd = (newChar: Character) => {
    onChange([...characters, newChar]);
    setIsCreating(false);
  };

  const handleUpdate = (updatedChar: Character) => {
    if (editingIndex === null) return;
    const newChars = [...characters];
    newChars[editingIndex] = updatedChar;
    onChange(newChars);
    setEditingIndex(null);
  };

  const handleDelete = (index: number) => {
    if (confirm('确定要删除这个角色吗？')) {
      const newChars = characters.filter((_, i) => i !== index);
      onChange(newChars);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs text-muted-foreground">
          共 {characters.length} 个角色
        </div>
        {!isCreating && editingIndex === null && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded hover:bg-primary/90 transition-colors"
          >
            <Icons.Plus size={14} />
            <span>添加角色</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4 pb-12">
        {isCreating && (
          <div className="animate-in slide-in-from-top-4 fade-in duration-200">
            <CharacterForm
              onSubmit={handleAdd}
              onCancel={() => setIsCreating(false)}
            />
          </div>
        )}

        {characters.length === 0 && !isCreating && (
          <div className="text-center py-12 text-muted-foreground bg-secondary/20 rounded-lg border border-dashed border-border">
            <Icons.Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">暂无角色档案</p>
            <button
              onClick={() => setIsCreating(true)}
              className="mt-4 text-primary text-xs hover:underline"
            >
              点击创建第一个角色
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {characters.map((char, index) => (
            editingIndex === index ? (
              <div key={index} className="md:col-span-2 animate-in fade-in zoom-in duration-200">
                <CharacterForm
                  initialData={char}
                  onSubmit={handleUpdate}
                  onCancel={() => setEditingIndex(null)}
                />
              </div>
            ) : (
              <CharacterCard
                key={index}
                character={char}
                onEdit={() => setEditingIndex(index)}
                onDelete={() => handleDelete(index)}
              />
            )
          ))}
        </div>
      </div>
    </div>
  );
};

// Add temporary icon to Icon.tsx if not exists, but we know Users is missing
// Just use existing icons for now or import Users
