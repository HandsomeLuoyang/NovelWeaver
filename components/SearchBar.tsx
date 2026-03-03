import React, { useState } from 'react';
import { Book } from '../types';
import { Icons } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../db';

interface SearchBarProps {
  books: Book[];
  onFilter: (filtered: Book[]) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ books, onFilter }) => {
  const [query, setQuery] = useState('');

  const handleSearch = (value: string) => {
    setQuery(value);

    if (!value.trim()) {
      onFilter(books);
      return;
    }

    const lowerQuery = value.toLowerCase();
    const filtered = books.filter(book =>
      book.title.toLowerCase().includes(lowerQuery) ||
      book.premise.toLowerCase().includes(lowerQuery) ||
      book.characters.some(char =>
        char.name.toLowerCase().includes(lowerQuery) ||
        char.role.toLowerCase().includes(lowerQuery)
      )
    );

    onFilter(filtered);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="搜索书名、梗概、角色..."
          className="w-full pl-10 pr-4 py-2 bg-card/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        />
        {query && (
          <button
            onClick={() => handleSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
