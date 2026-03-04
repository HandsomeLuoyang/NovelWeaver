import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { runConsistencyCheck, ConsistencyFinding } from '../services/consistencyService';
import { useStore } from '../store';
import { Icons } from './Icons';

interface ConsistencyCheckModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const severityStyle = {
  high: 'text-red-500 bg-red-500/10',
  medium: 'text-amber-500 bg-amber-500/10',
  low: 'text-blue-500 bg-blue-500/10',
} as const;

const severityLabel = {
  high: '高',
  medium: '中',
  low: '低',
} as const;

export const ConsistencyCheckModal: React.FC<ConsistencyCheckModalProps> = ({ isOpen, onClose }) => {
  const { currentBook, setActiveNodeId, expandedNodeIds, toggleNodeExpansion } = useStore();
  const [loading, setLoading] = useState(false);
  const [findings, setFindings] = useState<ConsistencyFinding[]>([]);
  const [allNodes, setAllNodes] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen || !currentBook) return;

    const run = async () => {
      setLoading(true);
      try {
        const [nodes, facts] = await Promise.all([
          db.nodes.where('bookId').equals(currentBook.id).toArray(),
          db.facts.where('bookId').equals(currentBook.id).toArray(),
        ]);
        setAllNodes(nodes);
        const result = runConsistencyCheck(currentBook, nodes, facts);
        setFindings(result);
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [isOpen, currentBook]);

  if (!isOpen) return null;

  const jumpToNode = (nodeId?: string) => {
    if (!nodeId) return;

    setActiveNodeId(nodeId);
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    let parentId = nodeMap.get(nodeId)?.parentId;

    while (parentId) {
      if (!expandedNodeIds.includes(parentId)) {
        toggleNodeExpansion(parentId);
      }
      parentId = nodeMap.get(parentId)?.parentId || null;
    }

    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[82vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.AlertTriangle size={18} className="text-amber-500" />
              一致性检查
            </h3>
            <p className="text-xs text-muted-foreground mt-1">检查结构完整性、角色出场和状态一致性</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">检查中...</div>
          )}

          {!loading && findings.length === 0 && (
            <div className="h-full flex items-center justify-center text-sm text-emerald-500">
              未发现明显一致性问题。
            </div>
          )}

          {!loading && findings.map((finding) => (
            <div key={finding.id} className="border border-border rounded-xl p-4 bg-secondary/20">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{finding.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-6">{finding.description}</div>
                </div>
                <span className={`px-2 py-1 rounded-full text-[10px] ${severityStyle[finding.severity]}`}>
                  {severityLabel[finding.severity]}优先级
                </span>
              </div>

              {finding.nodeId && (
                <div className="mt-3">
                  <button
                    onClick={() => jumpToNode(finding.nodeId)}
                    className="px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    定位到节点
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
