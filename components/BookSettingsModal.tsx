import React, { useEffect, useState } from 'react';
import { Book, Character } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { CharacterList } from './WorldBible/CharacterList';
import { exportAsMarkdown, exportAsText, exportAsHTML, downloadFile } from '../services/exportService';

interface Props {
  book: Book;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedBook: Book) => void;
}

export const BookSettingsModal: React.FC<Props> = ({ book, isOpen, onClose, onUpdate }) => {
  const [title, setTitle] = useState(book.title);
  const [premise, setPremise] = useState(book.premise);
  const [worldSetting, setWorldSetting] = useState(book.worldSetting);
  const [characters, setCharacters] = useState<Character[]>(book.characters || []);
  const [activeTab, setActiveTab] = useState<'basic' | 'world' | 'chars' | 'export'>('basic');

  useEffect(() => {
    if (!isOpen) return;
    setTitle(book.title);
    setPremise(book.premise);
    setWorldSetting(book.worldSetting);
    setCharacters(book.characters || []);
    setActiveTab('basic');
  }, [book, isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        alert("书名不能为空。");
        return;
      }

      const sanitizedCharacters = characters
        .map((char) => ({
          ...char,
          name: char.name.trim(),
          role: char.role.trim(),
          description: char.description.trim(),
          secret: char.secret.trim()
        }))
        .filter((char) => char.name.length > 0);

      const updatedBook: Book = {
        ...book,
        title: normalizedTitle,
        premise: premise.trim(),
        worldSetting: worldSetting.trim(),
        characters: sanitizedCharacters
      };

      await db.books.put(updatedBook);
      onUpdate(updatedBook);
      onClose();
    } catch (e) {
      console.error("Save failed", e);
      alert("保存失败，请检查数据。");
    }
  };

  const handleExport = async (format: 'md' | 'txt' | 'html') => {
    let content = '';
    let ext = '';

    switch (format) {
      case 'md':
        content = await exportAsMarkdown(book);
        ext = 'md';
        break;
      case 'txt':
        content = await exportAsText(book);
        ext = 'txt';
        break;
      case 'html':
        content = await exportAsHTML(book);
        ext = 'html';
        break;
    }

    downloadFile(content, `${book.title}.${ext}`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-card border border-border w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/50">
          <h2 className="text-lg font-bold text-foreground flex items-center">
            <Icons.Settings className="mr-2 w-5 h-5 text-primary" />
            书籍设定 / 记忆库
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground transition-colors">
            <Icons.Close className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-secondary/30">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'basic' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.FileText size={16} className="mr-2" />
            基础信息
            {activeTab === 'basic' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('world')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'world' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.BookOpen size={16} className="mr-2" />
            世界观设定
            {activeTab === 'world' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('chars')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'chars' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.Users size={16} className="mr-2" />
            角色档案
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-secondary border border-border rounded-full text-muted-foreground">
              {characters.length}
            </span>
            {activeTab === 'chars' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'export' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.Download size={16} className="mr-2" />
            导出书籍
            {activeTab === 'export' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-background/50">
          {activeTab === 'basic' && (
            <div className="space-y-6 max-w-2xl mx-auto animate-in slide-in-from-left-4 fade-in duration-200">
              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">书名</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg p-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-lg font-bold"
                  placeholder="请输入书名..."
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">核心梗概 (Premise)</label>
                <textarea
                  value={premise}
                  onChange={e => setPremise(e.target.value)}
                  className="w-full h-64 bg-input border border-border rounded-lg p-3 text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-none placeholder:text-muted-foreground/50"
                  placeholder="描述故事的核心创意、主要冲突和预期结局..."
                />
              </div>
            </div>
          )}

          {activeTab === 'world' && (
            <div className="h-full flex flex-col animate-in slide-in-from-right-4 fade-in duration-200">
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">世界观规则 / 设定集</label>
              <textarea
                value={worldSetting}
                onChange={e => setWorldSetting(e.target.value)}
                placeholder="在此输入详细的世界观设定，AI 将在写作时全程参考..."
                className="flex-1 bg-input border border-border rounded-lg p-4 text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed font-serif resize-none"
              />
            </div>
          )}

          {activeTab === 'chars' && (
            <div className="h-full animate-in slide-in-from-bottom-4 fade-in duration-200">
               <CharacterList
                 characters={characters}
                 onChange={setCharacters}
               />
            </div>
          )}

          {activeTab === 'export' && (
             <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in duration-200 pt-8">
                <div className="text-center">
                    <Icons.Download className="w-16 h-16 mx-auto text-primary/20 mb-4" />
                    <h3 className="text-xl font-bold text-foreground">导出您的作品</h3>
                    <p className="text-muted-foreground mt-2">选择一种格式下载整本书籍内容，包含世界观和角色设定。</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button
                        onClick={() => handleExport('md')}
                        className="flex flex-col items-center justify-center p-6 bg-secondary/30 hover:bg-secondary border border-border rounded-xl transition-all hover:scale-105"
                    >
                        <Icons.FileText className="w-8 h-8 text-blue-500 mb-3" />
                        <span className="font-bold">Markdown</span>
                        <span className="text-xs text-muted-foreground mt-1">适合 Obsidian / Typora</span>
                    </button>

                    <button
                        onClick={() => handleExport('html')}
                        className="flex flex-col items-center justify-center p-6 bg-secondary/30 hover:bg-secondary border border-border rounded-xl transition-all hover:scale-105"
                    >
                        <Icons.File className="w-8 h-8 text-orange-500 mb-3" />
                        <span className="font-bold">HTML / Word</span>
                        <span className="text-xs text-muted-foreground mt-1">适合浏览器或导入 Word</span>
                    </button>

                    <button
                        onClick={() => handleExport('txt')}
                        className="flex flex-col items-center justify-center p-6 bg-secondary/30 hover:bg-secondary border border-border rounded-xl transition-all hover:scale-105"
                    >
                        <Icons.FileText className="w-8 h-8 text-zinc-500 mb-3" />
                        <span className="font-bold">纯文本 (.txt)</span>
                        <span className="text-xs text-muted-foreground mt-1">通用格式，无样式</span>
                    </button>
                </div>
             </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-card/50 flex justify-end space-x-3 backdrop-blur-sm">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors text-sm font-medium">
            {activeTab === 'export' ? '关闭' : '取消'}
          </button>
          {activeTab !== 'export' && (
            <button onClick={handleSave} className="px-6 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex items-center text-sm shadow-lg shadow-primary/20">
              <Icons.Save className="w-4 h-4 mr-2" />
              保存变更
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
