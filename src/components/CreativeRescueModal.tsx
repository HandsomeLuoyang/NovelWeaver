import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Book, StoryNode } from '../types';
import { Icons } from './Icons';
import { generateInspirationPack, InspirationPack } from '../services/geminiService';
import { getAncestors, getLinearContext, getSemanticContext } from '../db';
import { useToast } from '../hooks/useToast';

interface CreativeRescueModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: StoryNode | null;
  book: Book | null;
  onInsertSnippet: (text: string) => void;
  onApplyDirectionToSummary: (text: string) => void;
}

const SectionList: React.FC<{
  title: string;
  items: string[];
  onInsert: (item: string) => void;
}> = ({ title, items, onInsert }) => (
  <div className="border border-border rounded-lg p-3 bg-background/50">
    <div className="text-sm font-semibold text-foreground mb-2">{title}</div>
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={`${title}-${index}`} className="rounded border border-border/70 bg-secondary/20 px-2.5 py-2">
          <div className="text-xs text-foreground leading-6">{item}</div>
          <button
            onClick={() => onInsert(item)}
            className="mt-2 px-2 py-1 text-[10px] rounded bg-primary/10 text-primary hover:bg-primary/20"
          >
            插入正文
          </button>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-xs text-muted-foreground italic">暂无内容</div>
      )}
    </div>
  </div>
);

export const CreativeRescueModal: React.FC<CreativeRescueModalProps> = ({
  isOpen,
  onClose,
  node,
  book,
  onInsertSnippet,
  onApplyDirectionToSummary,
}) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<InspirationPack | null>(null);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleGenerate = async () => {
    if (!node || !book) return;
    setLoading(true);
    setError('');
    try {
      const [ancestors, linearContext, semanticContext] = await Promise.all([
        getAncestors(node.id),
        getLinearContext(book.id, node.id, 5),
        getSemanticContext(book.id, node.id, `${node.title}\n${node.summary}`, 3),
      ]);
      const nextPack = await generateInspirationPack(node, book, ancestors, linearContext, semanticContext);
      setPack(nextPack);
      toast.success('灵感包生成完成');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || '灵感包生成失败');
      toast.error(err?.message || '灵感包生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleInsert = (item: string) => {
    onInsertSnippet(item);
    toast.success('已插入正文');
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-6xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border bg-card/70 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Icons.Sparkles size={18} className="text-primary" />
              卡文急救灵感包
            </h3>
            <p className="text-xs text-muted-foreground mt-1">生成可直接落笔的推进动作、冲突升级、反转与对白火花</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void handleGenerate(); }}
              disabled={loading || !node || !book}
              className="px-3 py-1.5 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              {loading ? '生成中...' : '重新生成'}
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-secondary rounded-full text-muted-foreground hover:text-foreground"
            >
              <Icons.Close size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 scrollbar-thin space-y-4">
          {!pack && !loading && !error && (
            <div className="h-full flex items-center justify-center">
              <button
                onClick={() => { void handleGenerate(); }}
                className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                生成灵感包
              </button>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}

          {pack && (
            <>
              <div className="border border-border rounded-lg p-3 bg-secondary/20">
                <div className="text-[11px] text-muted-foreground">一句话方向</div>
                <div className="text-sm text-foreground mt-1 leading-6">{pack.direction || '暂无方向建议'}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => onApplyDirectionToSummary(pack.direction)}
                    className="px-2.5 py-1 text-xs rounded bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20"
                  >
                    写入节点摘要
                  </button>
                  <button
                    onClick={() => handleInsert(`\n\n[推进方向]\n${pack.direction}\n`)}
                    className="px-2.5 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    插入正文
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                <SectionList title="下一步动作" items={pack.nextBeats} onInsert={handleInsert} />
                <SectionList title="冲突升级" items={pack.conflictEscalations} onInsert={handleInsert} />
                <SectionList title="反转候选" items={pack.twists} onInsert={handleInsert} />
                <SectionList title="对白火花" items={pack.dialogueHooks} onInsert={handleInsert} />
                <SectionList title="感官锚点" items={pack.sensoryAnchors} onInsert={handleInsert} />
                <SectionList title="悬念钩子" items={pack.cliffhangers} onInsert={handleInsert} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
