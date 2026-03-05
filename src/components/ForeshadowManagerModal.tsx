import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Book, ForeshadowEntry, ForeshadowStatus, StoryNode } from '../types';
import { db } from '../db';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface ForeshadowManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  currentNode: StoryNode | null;
  onJumpToNode?: (nodeId: string) => void;
}

const STATUS_META: Record<ForeshadowStatus, { label: string; className: string }> = {
  seeded: { label: '已埋下', className: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  progressed: { label: '已推进', className: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  payoff: { label: '已回收', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  dropped: { label: '弃坑', className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30' },
};

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const ForeshadowManagerModal: React.FC<ForeshadowManagerModalProps> = ({
  isOpen,
  onClose,
  book,
  currentNode,
  onJumpToNode,
}) => {
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [status, setStatus] = useState<ForeshadowStatus>('seeded');
  const [setupNodeId, setSetupNodeId] = useState('');
  const [payoffNodeId, setPayoffNodeId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const entries = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    const rows = await db.foreshadows.where('bookId').equals(book.id).toArray();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [isOpen, book?.id]) || [];

  const nodes = useLiveQuery(async () => {
    if (!isOpen || !book) return [];
    const rows = await db.nodes.where('bookId').equals(book.id).toArray();
    return rows.sort((a, b) => a.order - b.order);
  }, [isOpen, book?.id]) || [];

  const nodeTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => {
      map.set(node.id, node.title);
    });
    return map;
  }, [nodes]);

  const visibleEntries = useMemo(() => {
    if (statusFilter === 'all') return entries;
    if (statusFilter === 'open') {
      return entries.filter((entry) => entry.status === 'seeded' || entry.status === 'progressed');
    }
    return entries.filter((entry) => entry.status === 'payoff' || entry.status === 'dropped');
  }, [entries, statusFilter]);

  if (!isOpen || !book) return null;

  const resetDraft = () => {
    setEditingId(null);
    setTitle('');
    setNotes('');
    setTagsText('');
    setStatus('seeded');
    setSetupNodeId(currentNode?.id || '');
    setPayoffNodeId('');
  };

  const startCreate = () => {
    resetDraft();
  };

  const startEdit = (entry: ForeshadowEntry) => {
    setEditingId(entry.id);
    setTitle(entry.title);
    setNotes(entry.notes || '');
    setTagsText((entry.tags || []).join(', '));
    setStatus(entry.status);
    setSetupNodeId(entry.setupNodeId || '');
    setPayoffNodeId(entry.payoffNodeId || '');
  };

  const saveEntry = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      toast.warning('伏笔标题不能为空');
      return;
    }
    const now = Date.now();
    const tags = tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 8);

    const payload: ForeshadowEntry = {
      id: editingId || createId(),
      bookId: book.id,
      title: normalizedTitle,
      notes: notes.trim(),
      tags,
      setupNodeId: setupNodeId || undefined,
      payoffNodeId: payoffNodeId || undefined,
      status,
      createdAt: editingId
        ? (entries.find((entry) => entry.id === editingId)?.createdAt || now)
        : now,
      updatedAt: now,
    };

    await db.foreshadows.put(payload);
    toast.success(editingId ? '伏笔已更新' : '伏笔已添加');
    resetDraft();
  };

  const deleteEntry = async (entryId: string) => {
    if (!window.confirm('确定删除这条伏笔吗？')) return;
    await db.foreshadows.delete(entryId);
    toast.success('伏笔已删除');
    if (editingId === entryId) resetDraft();
  };

  const quickSetStatus = async (entry: ForeshadowEntry, nextStatus: ForeshadowStatus) => {
    await db.foreshadows.update(entry.id, {
      status: nextStatus,
      updatedAt: Date.now(),
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[126] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Target size={18} className="text-primary" />
              伏笔管理器
            </h3>
            <p className="text-xs text-muted-foreground mt-1">管理“埋点-推进-回收”，发布前避免遗留未收束线索</p>
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
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 text-xs rounded border ${statusFilter === 'all' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  全部
                </button>
                <button
                  onClick={() => setStatusFilter('open')}
                  className={`px-2.5 py-1 text-xs rounded border ${statusFilter === 'open' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  未回收
                </button>
                <button
                  onClick={() => setStatusFilter('closed')}
                  className={`px-2.5 py-1 text-xs rounded border ${statusFilter === 'closed' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'}`}
                >
                  已关闭
                </button>
              </div>
              <button
                onClick={startCreate}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                新增伏笔
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
              {visibleEntries.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-10 border border-dashed border-border rounded-lg bg-secondary/20">
                  暂无伏笔记录
                </div>
              )}

              {visibleEntries.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{entry.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META[entry.status].className}`}>
                          {STATUS_META[entry.status].label}
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

                  {(entry.notes || '').trim() && (
                    <p className="text-xs text-muted-foreground mt-2 leading-6 whitespace-pre-wrap">{entry.notes}</p>
                  )}

                  <div className="mt-2 space-y-1.5">
                    <div className="text-[11px] text-muted-foreground">
                      埋点：{entry.setupNodeId ? (nodeTitleMap.get(entry.setupNodeId) || '节点不存在') : '未关联'}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      回收：{entry.payoffNodeId ? (nodeTitleMap.get(entry.payoffNodeId) || '节点不存在') : '未关联'}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.setupNodeId && (
                      <button
                        onClick={() => entry.setupNodeId && onJumpToNode?.(entry.setupNodeId)}
                        className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        定位埋点
                      </button>
                    )}
                    {entry.payoffNodeId && (
                      <button
                        onClick={() => entry.payoffNodeId && onJumpToNode?.(entry.payoffNodeId)}
                        className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground"
                      >
                        定位回收
                      </button>
                    )}
                    <button
                      onClick={() => { void quickSetStatus(entry, 'progressed'); }}
                      className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground"
                    >
                      标记推进
                    </button>
                    <button
                      onClick={() => { void quickSetStatus(entry, 'payoff'); }}
                      className="px-2 py-0.5 text-[10px] rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                    >
                      标记回收
                    </button>
                    <button
                      onClick={() => { void quickSetStatus(entry, 'dropped'); }}
                      className="px-2 py-0.5 text-[10px] rounded border border-zinc-500/40 text-zinc-400 hover:bg-zinc-500/10"
                    >
                      标记弃坑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto scrollbar-thin">
            <h4 className="text-sm font-semibold text-foreground">{editingId ? '编辑伏笔' : '新增伏笔'}</h4>
            <label className="text-xs text-muted-foreground block">
              标题
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground"
                placeholder="例如：主角左手旧伤真正来源"
              />
            </label>

            <label className="text-xs text-muted-foreground block">
              状态
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ForeshadowStatus)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
              >
                <option value="seeded">已埋下</option>
                <option value="progressed">已推进</option>
                <option value="payoff">已回收</option>
                <option value="dropped">弃坑</option>
              </select>
            </label>

            <label className="text-xs text-muted-foreground block">
              埋点节点
              <select
                value={setupNodeId}
                onChange={(e) => setSetupNodeId(e.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
              >
                <option value="">不关联节点</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.title}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-muted-foreground block">
              回收节点
              <select
                value={payoffNodeId}
                onChange={(e) => setPayoffNodeId(e.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
              >
                <option value="">不关联节点</option>
                {nodes.map((node) => (
                  <option key={node.id} value={node.id}>{node.title}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-muted-foreground block">
              标签（逗号分隔）
              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="mt-1 w-full bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground"
                placeholder="身份、道具、伏线"
              />
            </label>

            <label className="text-xs text-muted-foreground block">
              备注
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full min-h-[160px] bg-input border border-border rounded px-2.5 py-2 text-sm text-foreground leading-6"
                placeholder="记录这条伏笔的预期推进路径与回收方式"
              />
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={() => { void saveEntry(); }}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {editingId ? '保存修改' : '添加伏笔'}
              </button>
              <button
                onClick={resetDraft}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
              >
                清空
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
