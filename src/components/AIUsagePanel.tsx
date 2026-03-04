import React, { useMemo } from 'react';
import { useStore } from '../store';
import { Icons } from './Icons';

export const AIUsagePanel: React.FC = () => {
  const { usageLog, clearUsageLog } = useStore();

  const summary = useMemo(() => {
    const totalTokens = usageLog.reduce((sum, item) => sum + item.estimatedTokens, 0);
    const totalCost = usageLog.reduce((sum, item) => sum + item.estimatedCostUSD, 0);

    const byTask = new Map<string, { tokens: number; cost: number; count: number }>();
    usageLog.forEach((item) => {
      const bucket = byTask.get(item.taskType) || { tokens: 0, cost: 0, count: 0 };
      bucket.tokens += item.estimatedTokens;
      bucket.cost += item.estimatedCostUSD;
      bucket.count += 1;
      byTask.set(item.taskType, bucket);
    });

    return {
      totalTokens,
      totalCost,
      byTask: [...byTask.entries()],
    };
  }, [usageLog]);

  return (
    <div className="mt-4 bg-card/30 border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Icons.Cpu size={14} className="text-primary" />
          AI 成本统计
        </h3>
        <button
          onClick={clearUsageLog}
          className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary"
        >
          清空记录
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-secondary/30 rounded-lg border border-border p-3">
          <div className="text-[11px] text-muted-foreground">累计估算 Token</div>
          <div className="text-lg font-bold text-foreground mt-1">{summary.totalTokens.toLocaleString()}</div>
        </div>
        <div className="bg-secondary/30 rounded-lg border border-border p-3">
          <div className="text-[11px] text-muted-foreground">累计估算成本 (USD)</div>
          <div className="text-lg font-bold text-primary mt-1">${summary.totalCost.toFixed(4)}</div>
        </div>
      </div>

      <div className="space-y-2">
        {summary.byTask.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">暂无统计数据</div>
        )}

        {summary.byTask.map(([taskType, bucket]) => (
          <div key={taskType} className="flex items-center justify-between text-xs border border-border rounded px-2 py-1.5 bg-background/40">
            <span className="text-foreground/90">{taskType}</span>
            <span className="text-muted-foreground">{bucket.count} 次 · {bucket.tokens.toLocaleString()} tokens · ${bucket.cost.toFixed(4)}</span>
          </div>
        ))}
      </div>

      {usageLog.length > 0 && (
        <div className="pt-2 border-t border-border space-y-2 max-h-44 overflow-y-auto scrollbar-thin">
          {usageLog.slice(0, 20).map((entry) => (
            <div key={entry.id} className="text-[11px] text-muted-foreground flex items-center justify-between">
              <span>{entry.taskType} · {entry.modelName}</span>
              <span>${entry.estimatedCostUSD.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
