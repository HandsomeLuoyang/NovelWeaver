import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Book } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { downloadFile } from '../services/exportService';

interface PublishPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
}

const buildPublishPack = (book: Book, sceneTitles: string[], platform: string) => {
  return [
    `# ${book.title} · ${platform} 发布包`,
    '',
    '## 书籍简介',
    book.premise,
    '',
    '## 发布文案',
    `《${book.title}》更新中。${book.worldSetting.slice(0, 140)}${book.worldSetting.length > 140 ? '...' : ''}`,
    '',
    '## 章节列表',
    ...sceneTitles.map((title, index) => `${index + 1}. ${title}`),
    '',
    '## 作者有话说模板',
    '这一章主要推进了人物关系和关键冲突，欢迎在评论区留言你最关注的伏笔。',
    '',
    '## 卷末总结模板',
    '本卷完成了阶段目标，下一卷将抬高代价并推进主线真相。',
  ].join('\n');
};

export const PublishPackModal: React.FC<PublishPackModalProps> = ({ isOpen, onClose, book }) => {
  const [platform, setPlatform] = useState('通用连载');
  const [sceneTitles, setSceneTitles] = useState<string[]>([]);
  const [packText, setPackText] = useState('');

  useEffect(() => {
    if (!isOpen || !book) return;
    const load = async () => {
      const nodes = await db.nodes.where('bookId').equals(book.id).toArray();
      const scenes = nodes.filter((node) => node.type === 'scene').sort((a, b) => a.order - b.order).map((node) => node.title);
      setSceneTitles(scenes);
      setPackText(buildPublishPack(book, scenes, platform));
    };
    void load();
  }, [book, isOpen, platform]);

  if (!isOpen || !book) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-4xl h-[78vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col ui-rise-in" onClick={(event) => event.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border bg-card/80 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.CheckCircle size={18} className="text-primary" />
              连载发布包
            </h3>
            <p className="text-xs text-muted-foreground mt-1">生成章节列表、作者有话说和卷末总结模板。</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
            <Icons.Close size={18} />
          </button>
        </div>
        <div className="px-6 py-4 border-b border-border bg-background/40 flex items-center gap-3">
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            平台
            <select value={platform} onChange={(event) => setPlatform(event.target.value)} className="rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground">
              <option value="通用连载">通用连载</option>
              <option value="起点风格">起点风格</option>
              <option value="番茄风格">番茄风格</option>
              <option value="晋江风格">晋江风格</option>
            </select>
          </label>
          <button onClick={() => downloadFile(packText, `${book.title}-publish-pack.txt`, 'text/plain;charset=utf-8')} className="px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm">
            导出发布包
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <textarea
            value={packText}
            onChange={(event) => setPackText(event.target.value)}
            className="w-full h-full min-h-[420px] rounded-2xl border border-border bg-secondary/10 px-4 py-4 text-sm text-foreground leading-7 resize-none focus:outline-none focus:border-primary/40"
          />
        </div>
      </div>
    </div>,
    document.body
  );
};
