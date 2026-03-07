import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Book, MaterialEntry, MaterialType, StoryNode } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';
import { MATERIAL_TYPE_LABEL } from '../services/materialLibrary';
import { ReferenceLinksField } from './ReferenceLinksField';

interface MaterialLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  currentNode: StoryNode | null;
  onJumpToNode?: (nodeId: string) => void;
}

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const TYPE_CLASSNAME: Record<MaterialType, string> = {
  snippet: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/30',
  idea: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  reference: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/30',
  note: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30',
};

export const MaterialLibraryModal: React.FC<MaterialLibraryModalProps> = ({
  isOpen,
  onClose,
  book,
  currentNode,
  onJumpToNode,
}) => {
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<MaterialType>('snippet');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [source, setSource] = useState('');
  const [linkedNodeId, setLinkedNodeId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | MaterialType>('all');

  const materials = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    const rows = await db.materials.where('bookId').equals(book.id).toArray();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [isOpen, book?.id]) || [];

  const nodes = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    const rows = await db.nodes.where('bookId').equals(book.id).toArray();
    return rows.sort((a, b) => a.order - b.order);
  }, [isOpen, book?.id]) || [];

  const nodeTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => map.set(node.id, node.title));
    return map;
  }, [nodes]);

  const filteredMaterials = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return materials.filter((entry) => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (!normalizedKeyword) return true;
      const indexable = `${entry.title}\n${entry.content}\n${entry.source || ''}\n${(entry.tags || []).join(' ')}`.toLowerCase();
      return indexable.includes(normalizedKeyword);
    });
  }, [materials, typeFilter, keyword]);

  if (!isOpen || !book) return null;

  const resetDraft = () => {
    setEditingId(null);
    setType('snippet');
    setTitle('');
    setContent('');
    setTagsText('');
    setSource('');
    setLinkedNodeId(currentNode?.id || '');
  };

  const startEdit = (entry: MaterialEntry) => {
    setEditingId(entry.id);
    setType(entry.type);
    setTitle(entry.title);
    setContent(entry.content);
    setTagsText((entry.tags || []).join(', '));
    setSource(entry.source || '');
    setLinkedNodeId(entry.linkedNodeId || '');
  };

  const saveEntry = async () => {
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle || !normalizedContent) {
      toast.warning('素材标题和内容不能为空');
      return;
    }

    const now = Date.now();
    const payload: MaterialEntry = {
      id: editingId || createId(),
      bookId: book.id,
      type,
      title: normalizedTitle,
      content: normalizedContent,
      tags: tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 8),
      source: source.trim() || undefined,
      linkedNodeId: linkedNodeId || undefined,
      createdAt: editingId ? (materials.find((entry) => entry.id === editingId)?.createdAt || now) : now,
      updatedAt: now,
    };

    await db.materials.put(payload);
    toast.success(editingId ? '素材已更新' : '素材已添加');
    resetDraft();
  };

  const deleteEntry = async (entryId: string) => {
    if (!window.confirm('确定删除这条素材吗？')) return;
    await db.materials.delete(entryId);
    if (editingId === entryId) {
      resetDraft();
    }
    toast.success('素材已删除');
  };

  return createPortal(
    <div className="fixed inset-0 z-[126] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[88vh] border border-border bg-card rounded-2xl shadow-2xl overflow-hidden flex flex-col ui-rise-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.BookOpen size={18} className="text-primary" />
              素材库
            </h3>
            <p className="text-xs text-muted-foreground mt-1">管理片段、创意、参考与笔记，供 AI 写作自动检索注入</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 xl:grid-cols-[1.4fr_1fr]">
          <div className="p-4 border-r border-border flex flex-col min-h-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-2.5 py-1 text-xs rounded border ${typeFilter === 'all' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                全部
              </button>
              {(['snippet', 'idea', 'reference', 'note'] as MaterialType[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setTypeFilter(item)}
                  className={`px-2.5 py-1 text-xs rounded border ${typeFilter === item ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  {MATERIAL_TYPE_LABEL[item]}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="检索标题/标签/内容"
                  className="w-44 bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
                />
                <button
                  onClick={resetDraft}
                  className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  新增素材
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {filteredMaterials.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-10 border border-dashed border-border rounded-lg bg-secondary/20">
                  暂无素材记录
                </div>
              )}

              {filteredMaterials.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{entry.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TYPE_CLASSNAME[entry.type]}`}>
                          {MATERIAL_TYPE_LABEL[entry.type]}
                        </span>
                        {(entry.tags || []).map((tag) => (
                          <span key={`${entry.id}-${tag}`} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(entry)}
                        className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground"
                        title="编辑"
                      >
                        <Icons.Edit size={12} />
                      </button>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        className="p-1.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                        title="删除"
                      >
                        <Icons.Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 leading-6 whitespace-pre-wrap line-clamp-4">{entry.content}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {entry.source && <span>来源: {entry.source}</span>}
                    {entry.linkedNodeId && (
                      <button
                        onClick={() => entry.linkedNodeId && onJumpToNode?.(entry.linkedNodeId)}
                        className="px-2 py-0.5 rounded border border-border hover:text-foreground"
                      >
                        定位节点: {nodeTitleMap.get(entry.linkedNodeId) || '已删除'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto scrollbar-thin">
            <h4 className="text-sm font-semibold text-foreground">{editingId ? '编辑素材' : '新增素材'}</h4>

            <label className="text-xs text-muted-foreground block">
              素材类型
              <select
                value={type}
                onChange={(event) => setType(event.target.value as MaterialType)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
              >
                <option value="snippet">片段</option>
                <option value="idea">创意</option>
                <option value="reference">参考</option>
                <option value="note">笔记</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground block">
              标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground"
                placeholder="例如：港口暴雨追逐场景"
              />
            </label>

            <label className="text-xs text-muted-foreground block">
              标签（逗号分隔）
              <input
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground"
                placeholder="动作、悬疑、台词"
              />
            </label>

            <label className="text-xs text-muted-foreground block">
              来源
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground"
                placeholder="例如：读书笔记/历史事件/影视拆解"
              />
            </label>

            <label className="text-xs text-muted-foreground block">
              关联节点（可选）
              <select
                value={linkedNodeId}
                onChange={(event) => setLinkedNodeId(event.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
              >
                <option value="">不关联节点</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.title}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-muted-foreground block">
              素材内容
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="mt-1 w-full min-h-[220px] bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground leading-6"
                placeholder="可粘贴片段、场景灵感、人物语气库、世界观参考、桥段拆解等。"
              />
            </label>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={resetDraft}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
              >
                清空
              </button>
              <button
                onClick={() => { void saveEntry(); }}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {editingId ? '保存更新' : '保存素材'}
              </button>
            </div>

            {editingId && (
              <ReferenceLinksField
                bookId={book.id}
                entityType="material"
                entityId={editingId}
                nodes={nodes}
                currentNodeId={currentNode?.id}
                onJumpToNode={onJumpToNode}
              />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
