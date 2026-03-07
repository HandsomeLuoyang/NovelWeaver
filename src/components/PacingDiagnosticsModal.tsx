import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { Book } from '../types';
import { Icons } from './Icons';
import { runPacingDiagnostics, PacingFinding } from '../services/pacingDiagnostics';

interface PacingDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book | null;
  onJumpToNode: (nodeId: string) => void;
}

export const PacingDiagnosticsModal: React.FC<PacingDiagnosticsModalProps> = ({ isOpen, onClose, book, onJumpToNode }) => {
  const [loading, setLoading] = useState(false);
  const [findings, setFindings] = useState<PacingFinding[]>([]);
  const [sceneCount, setSceneCount] = useState(0);
  const [draftedCount, setDraftedCount] = useState(0);

  useEffect(() => {
    if (!isOpen || !book) return;
    const load = async () => {
      setLoading(true);
      try {
        const nodes = await db.nodes.where('bookId').equals(book.id).toArray();
        const report = runPacingDiagnostics(nodes);
        setFindings(report.findings);
        setSceneCount(report.sceneCount);
        setDraftedCount(report.draftedCount);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [book, isOpen]);

  if (!isOpen || !book) return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-4xl h-[78vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col ui-rise-in" onClick={(event) => event.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border bg-card/80 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.BarChart3 size={18} className="text-primary" />
              剧情节奏诊断
            </h3>
            <p className="text-xs text-muted-foreground mt-1">快速找出拖沓区、平段和缺少推进的场景。</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground">
            <Icons.Close size={18} />
          </button>
        </div>
        <div className="px-6 py-4 border-b border-border bg-background/40 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
            <div className="text-xs text-muted-foreground">总场景数</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{sceneCount}</div>
          </div>
          <div className="rounded-xl border border-border bg-secondary/15 px-4 py-3">
            <div className="text-xs text-muted-foreground">已起草场景</div>
            <div className="mt-1 text-xl font-semibold text-foreground">{draftedCount}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {loading && <div className="text-sm text-muted-foreground">分析中...</div>}
          {!loading && findings.length === 0 && <div className="text-sm text-emerald-500">未发现明显的节奏问题。</div>}
          {!loading && findings.map((finding) => (
            <div key={finding.id} className="rounded-xl border border-border bg-secondary/15 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{finding.title}</div>
                  <div className="text-xs text-muted-foreground mt-1 leading-6">{finding.description}</div>
                </div>
                <span className={`px-2 py-1 rounded-full text-[10px] ${
                  finding.severity === 'high'
                    ? 'bg-red-500/10 text-red-500'
                    : finding.severity === 'medium'
                      ? 'bg-amber-500/10 text-amber-500'
                      : 'bg-blue-500/10 text-blue-500'
                }`}>
                  {finding.severity.toUpperCase()}
                </span>
              </div>
              {finding.nodeId && (
                <button
                  onClick={() => {
                    onJumpToNode(finding.nodeId!);
                    onClose();
                  }}
                  className="mt-3 px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20"
                >
                  定位场景
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
