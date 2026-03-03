import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../db';
import { Book } from '../types';
import { Icons } from './Icons';
import { evaluatePublishWorkflow, PublishWorkflowReport } from '../services/publishWorkflowService';

interface PublishWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
}

export const PublishWorkflowModal: React.FC<PublishWorkflowModalProps> = ({ isOpen, onClose, book }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<PublishWorkflowReport | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const load = async () => {
      setLoading(true);
      try {
        const nodes = await db.nodes.where('bookId').equals(book.id).toArray();
        const workflowReport = evaluatePublishWorkflow(book, nodes);
        setReport(workflowReport);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [book, isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[118] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[82vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.CheckCircle size={18} className="text-emerald-500" />
              发布工作流
            </h3>
            <p className="text-xs text-muted-foreground mt-1">阶段门禁 + 质量评分，用于发布前验收</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">评估中...</div>
          )}

          {!loading && report && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="text-[11px] text-muted-foreground">质量评分</div>
                  <div className="text-2xl font-bold text-primary mt-1">{report.qualityScore}</div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="text-[11px] text-muted-foreground">大纲完整度</div>
                  <div className="text-lg font-semibold text-foreground mt-1">{(report.outlineCompleteness * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="text-[11px] text-muted-foreground">草稿覆盖率</div>
                  <div className="text-lg font-semibold text-foreground mt-1">{(report.draftCoverage * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <div className="text-[11px] text-muted-foreground">元数据覆盖率</div>
                  <div className="text-lg font-semibold text-foreground mt-1">{(report.metadataCoverage * 100).toFixed(1)}%</div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="text-xs font-semibold text-foreground mb-2">一致性问题摘要</div>
                <div className="text-xs text-muted-foreground">
                  高优先级 {report.findingsSummary.high} · 中优先级 {report.findingsSummary.medium} · 低优先级 {report.findingsSummary.low}
                </div>
              </div>

              <div className="space-y-3">
                {report.stages.map((stage) => (
                  <div key={stage.id} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{stage.title}</div>
                        <div className="text-xs text-muted-foreground mt-1">{stage.description}</div>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded-full ${stage.passed ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                        {stage.passed ? '通过' : '未通过'}
                      </div>
                    </div>

                    {stage.blockers.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {stage.blockers.map((blocker, index) => (
                          <div key={index} className="text-xs text-amber-500">- {blocker}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
