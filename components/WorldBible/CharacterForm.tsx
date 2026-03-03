import React, { useState, useEffect } from 'react';
import { Character } from '../../types';
import { Icons } from '../Icons';

interface Props {
  initialData?: Character;
  onSubmit: (char: Character) => void;
  onCancel: () => void;
}

export const CharacterForm: React.FC<Props> = ({ initialData, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState<Character>({
    name: '',
    role: '',
    description: '',
    secret: ''
  });

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-secondary/20 rounded-lg border border-border">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">姓名 (Name)</label>
          <input
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="w-full bg-input border border-border rounded p-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none"
            placeholder="例如：林默"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">角色定位 (Role)</label>
          <input
            name="role"
            value={formData.role}
            onChange={handleChange}
            required
            className="w-full bg-input border border-border rounded p-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none"
            placeholder="例如：主角，反派，导师"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-muted-foreground uppercase mb-1">人物简介 (Description)</label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          required
          rows={3}
          className="w-full bg-input border border-border rounded p-2 text-sm focus:ring-1 focus:ring-primary focus:outline-none resize-none"
          placeholder="外貌、性格、能力等基本信息..."
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-orange-500/80 uppercase mb-1 flex items-center">
          <Icons.Target size={12} className="mr-1" />
          不为人知的秘密 / 伏笔 (Secret)
        </label>
        <textarea
          name="secret"
          value={formData.secret}
          onChange={handleChange}
          rows={2}
          className="w-full bg-orange-500/5 border border-orange-500/20 rounded p-2 text-sm focus:ring-1 focus:ring-orange-500 focus:outline-none resize-none placeholder:text-orange-500/30"
          placeholder="只有作者知道的深层动机或身世之谜..."
        />
      </div>

      <div className="flex justify-end space-x-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary rounded transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors flex items-center"
        >
          <Icons.Check size={12} className="mr-1" />
          {initialData ? '更新角色' : '添加角色'}
        </button>
      </div>
    </form>
  );
};
