import React, { useEffect, useState } from 'react';
import { Book, Character, FactCandidate, FactEntry, StoryNode, WritingStyle } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { CharacterList } from './WorldBible/CharacterList';
import { RelationGraph } from './WorldBible/RelationGraph';
import { exportAsMarkdown, exportAsText, exportAsHTML, exportAsDocx, exportAsEpub, downloadFile } from '../services/exportService';
import { FactLibraryPanel } from './FactLibraryPanel';

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
  const [writingStyle, setWritingStyle] = useState<WritingStyle>(book.writingStyle || 'balanced');
  const [styleReferencesText, setStyleReferencesText] = useState((book.styleReferences || []).join('\n'));
  const [styleRules, setStyleRules] = useState(book.styleBible?.rules || '');
  const [styleBannedTermsText, setStyleBannedTermsText] = useState((book.styleBible?.bannedTerms || []).join('，'));
  const [styleSentencePatternsText, setStyleSentencePatternsText] = useState((book.styleBible?.sentencePatterns || []).join('\n'));
  const [facts, setFacts] = useState<FactEntry[]>([]);
  const [factCandidates, setFactCandidates] = useState<FactCandidate[]>([]);
  const [graphNodes, setGraphNodes] = useState<StoryNode[]>([]);
  const [activeTab, setActiveTab] = useState<'basic' | 'world' | 'chars' | 'facts' | 'graph' | 'export'>('basic');

  useEffect(() => {
    if (!isOpen) return;
    setTitle(book.title);
    setPremise(book.premise);
    setWorldSetting(book.worldSetting);
    setCharacters(book.characters || []);
    setWritingStyle(book.writingStyle || 'balanced');
    setStyleReferencesText((book.styleReferences || []).join('\n'));
    setStyleRules(book.styleBible?.rules || '');
    setStyleBannedTermsText((book.styleBible?.bannedTerms || []).join('，'));
    setStyleSentencePatternsText((book.styleBible?.sentencePatterns || []).join('\n'));
    setActiveTab('basic');
    void (async () => {
      const [factList, candidateList] = await Promise.all([
        db.facts.where('bookId').equals(book.id).toArray(),
        db.factCandidates.where('bookId').equals(book.id).toArray(),
      ]);
      setFacts(factList.sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt));
      setFactCandidates(candidateList.sort((a, b) => b.createdAt - a.createdAt));
    })();
  }, [book, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const loadNodes = async () => {
      const nodes = await db.nodes.where('bookId').equals(book.id).toArray();
      setGraphNodes(nodes);
    };

    void loadNodes();
  }, [book.id, isOpen]);

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
        characters: sanitizedCharacters,
        writingStyle,
        styleReferences: styleReferencesText
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 20),
        styleBible: {
          rules: styleRules.trim(),
          bannedTerms: styleBannedTermsText
            .split(/[，,]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 30),
          sentencePatterns: styleSentencePatternsText
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 20),
        }
      };

      const now = Date.now();
      const sanitizedFacts = facts
        .map((fact) => ({
          ...fact,
          bookId: book.id,
          statement: fact.statement.trim(),
          notes: (fact.notes || '').trim(),
          tags: (fact.tags || []).map((tag) => tag.trim()).filter((tag) => tag.length > 0).slice(0, 8),
          createdAt: fact.createdAt || now,
          updatedAt: now,
        }))
        .filter((fact) => fact.statement.length > 0 && fact.status === 'active');

      const sanitizedCandidates = factCandidates
        .map((candidate) => ({
          ...candidate,
          bookId: book.id,
          statement: candidate.statement.trim(),
          createdAt: candidate.createdAt || now,
        }))
        .filter((candidate) => candidate.statement.length > 0);

      await db.transaction('rw', [db.books, db.facts, db.factCandidates], async () => {
        await db.books.put(updatedBook);
        await db.facts.where('bookId').equals(book.id).delete();
        await db.factCandidates.where('bookId').equals(book.id).delete();
        if (sanitizedFacts.length > 0) {
          await db.facts.bulkPut(sanitizedFacts);
        }
        if (sanitizedCandidates.length > 0) {
          await db.factCandidates.bulkPut(sanitizedCandidates);
        }
      });
      onUpdate(updatedBook);
      onClose();
    } catch (e) {
      console.error("Save failed", e);
      alert("保存失败，请检查数据。");
    }
  };

  const handleExport = async (format: 'md' | 'txt' | 'html' | 'docx' | 'epub') => {
    let content: string | Blob | Uint8Array = '';
    let ext = '';
    let mimeType = 'text/plain;charset=utf-8';

    switch (format) {
      case 'md':
        content = await exportAsMarkdown(book);
        ext = 'md';
        mimeType = 'text/markdown;charset=utf-8';
        break;
      case 'txt':
        content = await exportAsText(book);
        ext = 'txt';
        mimeType = 'text/plain;charset=utf-8';
        break;
      case 'html':
        content = await exportAsHTML(book);
        ext = 'html';
        mimeType = 'text/html;charset=utf-8';
        break;
      case 'docx':
        content = await exportAsDocx(book);
        ext = 'docx';
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
      case 'epub':
        content = await exportAsEpub(book);
        ext = 'epub';
        mimeType = 'application/epub+zip';
        break;
    }

    downloadFile(content, `${book.title}.${ext}`, mimeType);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="border border-border bg-card w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 ui-rise-in">
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
            onClick={() => setActiveTab('facts')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'facts' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.AlertCircle size={16} className="mr-2" />
            事实库
            <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-secondary border border-border rounded-full text-muted-foreground">
              {facts.filter((fact) => fact.status === 'active').length}
            </span>
            {activeTab === 'facts' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
          <button
            onClick={() => setActiveTab('graph')}
            className={`flex items-center px-6 py-3 text-sm font-medium transition-all relative ${activeTab === 'graph' ? 'text-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Icons.GitBranch size={16} className="mr-2" />
            关系图谱
            {activeTab === 'graph' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
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
              <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">风格圣经</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    写作风格
                    <select
                      value={writingStyle}
                      onChange={(event) => setWritingStyle(event.target.value as WritingStyle)}
                      className="bg-input border border-border rounded px-2 py-2 text-xs text-foreground"
                    >
                      <option value="balanced">平衡型</option>
                      <option value="realistic">现实主义</option>
                      <option value="poetic">诗意派</option>
                      <option value="noir">黑色幽默</option>
                      <option value="suspense">悬疑</option>
                      <option value="minimalist">极简主义</option>
                      <option value="maximalist">巴洛克式</option>
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    参考作品（每行一条）
                    <textarea
                      value={styleReferencesText}
                      onChange={(event) => setStyleReferencesText(event.target.value)}
                      className="min-h-[84px] bg-input border border-border rounded px-2 py-2 text-xs text-foreground leading-6"
                      placeholder="例如：冰与火之歌&#10;边城"
                    />
                  </label>
                </div>
                <label className="text-xs text-muted-foreground flex flex-col gap-1">
                  风格规则
                  <textarea
                    value={styleRules}
                    onChange={(event) => setStyleRules(event.target.value)}
                    className="min-h-[100px] bg-input border border-border rounded px-2 py-2 text-xs text-foreground leading-6"
                    placeholder="例如：叙述克制，避免上帝视角跳切；对白简短有潜台词。"
                  />
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    禁用词（逗号分隔）
                    <input
                      value={styleBannedTermsText}
                      onChange={(event) => setStyleBannedTermsText(event.target.value)}
                      className="bg-input border border-border rounded px-2 py-2 text-xs text-foreground"
                      placeholder="无敌、碾压、绝美"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    句式偏好（每行一条）
                    <textarea
                      value={styleSentencePatternsText}
                      onChange={(event) => setStyleSentencePatternsText(event.target.value)}
                      className="min-h-[84px] bg-input border border-border rounded px-2 py-2 text-xs text-foreground leading-6"
                      placeholder="短句推进&#10;动作-感受-判断"
                    />
                  </label>
                </div>
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

          {activeTab === 'graph' && (
            <div className="max-w-4xl mx-auto animate-in fade-in duration-200">
              <RelationGraph characters={characters} nodes={graphNodes} />
            </div>
          )}

          {activeTab === 'facts' && (
            <div className="h-full animate-in fade-in duration-200">
              <FactLibraryPanel
                bookId={book.id}
                facts={facts}
                candidates={factCandidates}
                onFactsChange={setFacts}
                onCandidatesChange={setFactCandidates}
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

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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

                    <button
                        onClick={() => handleExport('docx')}
                        className="flex flex-col items-center justify-center p-6 bg-secondary/30 hover:bg-secondary border border-border rounded-xl transition-all hover:scale-105"
                    >
                        <Icons.File className="w-8 h-8 text-sky-500 mb-3" />
                        <span className="font-bold">DOCX</span>
                        <span className="text-xs text-muted-foreground mt-1">适合 Word / 编辑审阅</span>
                    </button>

                    <button
                        onClick={() => handleExport('epub')}
                        className="flex flex-col items-center justify-center p-6 bg-secondary/30 hover:bg-secondary border border-border rounded-xl transition-all hover:scale-105"
                    >
                        <Icons.BookOpen className="w-8 h-8 text-emerald-500 mb-3" />
                        <span className="font-bold">EPUB</span>
                        <span className="text-xs text-muted-foreground mt-1">适合电子书阅读器</span>
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
