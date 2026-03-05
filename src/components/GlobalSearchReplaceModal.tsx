import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Book, StoryNode } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface GlobalSearchReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  onJumpToNode?: (nodeId: string) => void;
}

type ReplaceScope = {
  title: boolean;
  summary: boolean;
  content: boolean;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRegExp = (needle: string, caseSensitive: boolean) => {
  const flags = caseSensitive ? 'g' : 'gi';
  return new RegExp(escapeRegExp(needle), flags);
};

const countOccurrences = (source: string, needle: string, caseSensitive: boolean) => {
  if (!needle) return 0;
  const matches = source.match(buildRegExp(needle, caseSensitive));
  return matches ? matches.length : 0;
};

const previewExcerpt = (text: string, needle: string, caseSensitive: boolean) => {
  const source = caseSensitive ? text : text.toLowerCase();
  const target = caseSensitive ? needle : needle.toLowerCase();
  const index = source.indexOf(target);
  if (index < 0) return text.slice(0, 80);
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + needle.length + 40);
  return text.slice(start, end).replace(/\s+/g, ' ');
};

export const GlobalSearchReplaceModal: React.FC<GlobalSearchReplaceModalProps> = ({
  isOpen,
  onClose,
  book,
  onJumpToNode,
}) => {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<ReplaceScope>({ title: false, summary: true, content: true });
  const [isApplying, setIsApplying] = useState(false);

  const nodes = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    const rows = await db.nodes.where('bookId').equals(book.id).toArray();
    return rows.sort((a, b) => a.order - b.order);
  }, [isOpen, book?.id]) || [];

  const matched = useMemo(() => {
    const needle = query.trim();
    if (!needle) return [] as Array<{ node: StoryNode; hits: number; excerpts: string[] }>;

    return nodes.map((node) => {
      const excerpts: string[] = [];
      let hits = 0;

      if (scope.title) {
        const title = node.title || '';
        const count = countOccurrences(title, needle, caseSensitive);
        hits += count;
        if (count > 0) excerpts.push(`标题: ${previewExcerpt(title, needle, caseSensitive)}`);
      }
      if (scope.summary) {
        const summary = node.summary || '';
        const count = countOccurrences(summary, needle, caseSensitive);
        hits += count;
        if (count > 0) excerpts.push(`摘要: ${previewExcerpt(summary, needle, caseSensitive)}`);
      }
      if (scope.content) {
        const content = node.content || '';
        const count = countOccurrences(content, needle, caseSensitive);
        hits += count;
        if (count > 0) excerpts.push(`正文: ${previewExcerpt(content, needle, caseSensitive)}`);
      }

      return { node, hits, excerpts };
    }).filter((row) => row.hits > 0);
  }, [nodes, query, caseSensitive, scope]);

  const totalHits = useMemo(() => matched.reduce((sum, item) => sum + item.hits, 0), [matched]);

  if (!isOpen || !book) return null;

  const applyReplaceAll = async () => {
    const needle = query.trim();
    if (!needle) {
      toast.warning('请先输入检索关键词');
      return;
    }
    if (!scope.title && !scope.summary && !scope.content) {
      toast.warning('请至少选择一个替换范围');
      return;
    }
    if (matched.length === 0) {
      toast.info('没有命中内容，无需替换');
      return;
    }
    if (!window.confirm(`确认替换 ${matched.length} 个节点、共 ${totalHits} 处匹配吗？`)) return;

    setIsApplying(true);
    try {
      const reg = buildRegExp(needle, caseSensitive);
      let affectedNodes = 0;
      let replacedCount = 0;

      await db.transaction('rw', db.nodes, async () => {
        for (const row of matched) {
          const node = row.node;
          const patch: Partial<StoryNode> = {};
          let changed = false;

          if (scope.title) {
            const source = node.title || '';
            const count = countOccurrences(source, needle, caseSensitive);
            if (count > 0) {
              patch.title = source.replace(reg, replaceWith);
              replacedCount += count;
              changed = true;
            }
          }
          if (scope.summary) {
            const source = node.summary || '';
            const count = countOccurrences(source, needle, caseSensitive);
            if (count > 0) {
              patch.summary = source.replace(reg, replaceWith);
              replacedCount += count;
              changed = true;
            }
          }
          if (scope.content) {
            const source = node.content || '';
            const count = countOccurrences(source, needle, caseSensitive);
            if (count > 0) {
              patch.content = source.replace(reg, replaceWith);
              replacedCount += count;
              changed = true;
            }
          }

          if (changed) {
            await db.nodes.update(node.id, patch);
            affectedNodes += 1;
          }
        }
      });

      toast.success(`替换完成：${affectedNodes} 个节点，${replacedCount} 处替换`);
    } catch (error) {
      console.error(error);
      toast.error('替换失败，请稍后重试');
    } finally {
      setIsApplying(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[127] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[84vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Search size={18} className="text-primary" />
              全书检索替换
            </h3>
            <p className="text-xs text-muted-foreground mt-1">跨标题/摘要/正文统一术语，快速修正全书命名</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="border-b border-border px-4 py-3 space-y-3 bg-background/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
              placeholder="检索词（例如：林秋）"
            />
            <input
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              className="bg-input border border-border rounded px-3 py-2 text-sm text-foreground"
              placeholder="替换为（例如：林丘）"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={scope.title} onChange={(e) => setScope((prev) => ({ ...prev, title: e.target.checked }))} />
              标题
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={scope.summary} onChange={(e) => setScope((prev) => ({ ...prev, summary: e.target.checked }))} />
              摘要
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={scope.content} onChange={(e) => setScope((prev) => ({ ...prev, content: e.target.checked }))} />
              正文
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              区分大小写
            </label>
            <div className="ml-auto text-xs text-muted-foreground">
              命中节点 {matched.length} · 匹配总数 {totalHits}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
          {matched.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-12 border border-dashed border-border rounded-lg bg-secondary/20">
              {query.trim() ? '未找到匹配内容' : '请输入检索词'}
            </div>
          ) : (
            matched.map((item) => (
              <div key={item.node.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{item.node.title}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">命中 {item.hits} 处</div>
                  </div>
                  <button
                    onClick={() => onJumpToNode?.(item.node.id)}
                    className="px-2 py-1 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    定位节点
                  </button>
                </div>
                <div className="mt-2 space-y-1">
                  {item.excerpts.map((excerpt, index) => (
                    <div key={`${item.node.id}-${index}`} className="text-xs text-muted-foreground bg-background/50 border border-border/50 rounded px-2 py-1.5">
                      {excerpt}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t border-border bg-card/70 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-border text-muted-foreground hover:text-foreground"
          >
            关闭
          </button>
          <button
            onClick={() => { void applyReplaceAll(); }}
            disabled={isApplying || matched.length === 0 || !query.trim()}
            className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isApplying ? '替换中...' : '全部替换'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
