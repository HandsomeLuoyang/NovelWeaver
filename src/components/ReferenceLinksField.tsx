import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { ReferenceEntityType, StoryNode } from '../types';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface ReferenceLinksFieldProps {
  bookId: string;
  entityType: ReferenceEntityType;
  entityId: string;
  nodes: StoryNode[];
  currentNodeId?: string;
  onJumpToNode?: (nodeId: string) => void;
}

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const ReferenceLinksField: React.FC<ReferenceLinksFieldProps> = ({
  bookId,
  entityType,
  entityId,
  nodes,
  currentNodeId,
  onJumpToNode,
}) => {
  const toast = useToast();
  const [selectedNodeId, setSelectedNodeId] = useState(currentNodeId || '');
  const [excerpt, setExcerpt] = useState('');

  const references = useLiveQuery(async () => {
    if (!entityId) return [];
    const rows = await db.references.where('[entityType+entityId]').equals([entityType, entityId]).toArray();
    return rows.filter((row) => row.bookId === bookId).sort((a, b) => b.createdAt - a.createdAt);
  }, [bookId, entityType, entityId]) || [];

  const nodeTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    nodes.forEach((node) => map.set(node.id, node.title));
    return map;
  }, [nodes]);

  const addReference = async () => {
    if (!selectedNodeId) {
      toast.warning('请选择要关联的节点');
      return;
    }
    if (references.some((reference) => reference.nodeId === selectedNodeId)) {
      toast.info('该节点已经关联过了');
      return;
    }
    await db.references.put({
      id: createId(),
      bookId,
      entityType,
      entityId,
      nodeId: selectedNodeId,
      excerpt: excerpt.trim(),
      createdAt: Date.now(),
    });
    setExcerpt('');
    toast.success('已添加引用关系');
  };

  const removeReference = async (referenceId: string) => {
    await db.references.delete(referenceId);
    toast.success('已移除引用关系');
  };

  return (
    <div className="rounded-xl border border-border bg-background/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-foreground">引用回查</div>
          <div className="text-[11px] text-muted-foreground mt-1">把当前条目和实际使用它的场景连起来，便于回跳定位。</div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">{references.length} 条</span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <select
          value={selectedNodeId}
          onChange={(event) => setSelectedNodeId(event.target.value)}
          className="w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
        >
          <option value="">选择引用节点</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>{node.title}</option>
          ))}
        </select>
        <input
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          className="w-full bg-input border border-border rounded px-2.5 py-2 text-xs text-foreground"
          placeholder="可选：记录命中片段 / 用途说明"
        />
        <div className="flex justify-end">
          <button
            onClick={() => { void addReference(); }}
            className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20"
          >
            添加引用节点
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin pr-1">
        {references.length === 0 && (
          <div className="text-[11px] text-muted-foreground italic border border-dashed border-border rounded-lg p-3">
            还没有建立引用关系。
          </div>
        )}
        {references.map((reference) => (
          <div key={reference.id} className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground truncate">{nodeTitleMap.get(reference.nodeId) || '节点不存在'}</div>
                {reference.excerpt && (
                  <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{reference.excerpt}</div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onJumpToNode && (
                  <button
                    onClick={() => onJumpToNode(reference.nodeId)}
                    className="p-1.5 rounded border border-border text-muted-foreground hover:text-foreground"
                    title="跳转到节点"
                  >
                    <Icons.Search size={12} />
                  </button>
                )}
                <button
                  onClick={() => { void removeReference(reference.id); }}
                  className="p-1.5 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                  title="移除引用"
                >
                  <Icons.Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
