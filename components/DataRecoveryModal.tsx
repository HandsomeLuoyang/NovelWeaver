import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PersistenceService, RecoverySnapshotMeta } from '../services/persistence';
import { Icons } from './Icons';
import { useToast } from '../hooks/useToast';

interface DataRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored?: () => void;
}

export const DataRecoveryModal: React.FC<DataRecoveryModalProps> = ({ isOpen, onClose, onRestored }) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<RecoverySnapshotMeta[]>([]);
  const [integrityInfo, setIntegrityInfo] = useState<string>('');

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const list = await PersistenceService.listRecoverySnapshots();
      setSnapshots(list);
    } catch (error) {
      console.error(error);
      toast.error('加载恢复快照失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadSnapshots();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateSnapshot = async () => {
    try {
      await PersistenceService.createManualRecoverySnapshot();
      await loadSnapshots();
      toast.success('已创建手动恢复快照');
    } catch (error) {
      console.error(error);
      toast.error('创建恢复快照失败');
    }
  };

  const handleVerify = async () => {
    try {
      const report = await PersistenceService.verifyCurrentDataIntegrity();
      if (report.ok) {
        setIntegrityInfo('当前数据完整性校验通过');
        toast.success('完整性校验通过');
      } else {
        setIntegrityInfo(`发现问题：${report.issues.join('；')}`);
        toast.warning('发现数据完整性风险');
      }
    } catch (error) {
      console.error(error);
      toast.error('完整性校验失败');
    }
  };

  const handleRestore = async (snapshotId: string) => {
    if (!window.confirm('恢复快照会覆盖当前数据，是否继续？')) return;

    try {
      const report = await PersistenceService.restoreRecoverySnapshot(snapshotId);
      if (!report.ok) {
        toast.error(`恢复失败：${report.issues.join('；')}`);
        return;
      }
      toast.success('恢复成功，已切换到选定时间点');
      onRestored?.();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('恢复失败');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl h-[82vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/70">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.History size={18} className="text-cyan-500" />
              数据恢复中心
            </h3>
            <p className="text-xs text-muted-foreground mt-1">自动快照轮转 + 时间点恢复 + 完整性校验</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icons.Close size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-border bg-background/30 flex items-center gap-2">
          <button
            onClick={() => { void handleCreateSnapshot(); }}
            className="px-3 py-1.5 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
          >
            创建手动快照
          </button>
          <button
            onClick={() => { void handleVerify(); }}
            className="px-3 py-1.5 text-xs rounded bg-secondary text-muted-foreground hover:text-foreground"
          >
            校验当前数据
          </button>
          {integrityInfo && <span className="text-xs text-muted-foreground">{integrityInfo}</span>}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">加载快照中...</div>
          )}

          {!loading && snapshots.length === 0 && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              暂无恢复快照，先创建一次手动快照。
            </div>
          )}

          {!loading && snapshots.map((snapshot) => (
            <div key={snapshot.id} className="border border-border rounded-xl bg-secondary/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>时间：{new Date(snapshot.createdAt).toLocaleString()}</div>
                  <div>类型：{snapshot.source === 'manual' ? '手动' : '自动'} · 大小：{Math.round(snapshot.size / 1024)} KB</div>
                  <div>校验：{snapshot.checksum}</div>
                </div>
                <button
                  onClick={() => { void handleRestore(snapshot.id); }}
                  className="px-3 py-1.5 text-xs rounded bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20"
                >
                  恢复到此时间点
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
};
