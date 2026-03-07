import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FactCandidate, FactCategory, FactEntry } from '../types';
import { Icons } from './Icons';
import { db } from '../db';
import { useToast } from '../hooks/useToast';
import { extractFactCandidatesFromNodes, FACT_CATEGORY_LABEL } from '../services/factLibrary';
import { ReferenceLinksField } from './ReferenceLinksField';

interface FactLibraryPanelProps {
  bookId: string;
  facts: FactEntry[];
  candidates: FactCandidate[];
  onFactsChange: (facts: FactEntry[]) => void;
  onCandidatesChange: (candidates: FactCandidate[]) => void;
}

const CATEGORY_OPTIONS = Object.keys(FACT_CATEGORY_LABEL) as FactCategory[];

const createId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

const sortFacts = (facts: FactEntry[]) => {
  return [...facts].sort((a, b) => Number(b.locked) - Number(a.locked) || b.updatedAt - a.updatedAt);
};

export const FactLibraryPanel: React.FC<FactLibraryPanelProps> = ({
  bookId,
  facts,
  candidates,
  onFactsChange,
  onCandidatesChange,
}) => {
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statement, setStatement] = useState('');
  const [category, setCategory] = useState<FactCategory>('custom');
  const [tagsText, setTagsText] = useState('');
  const [notes, setNotes] = useState('');
  const [locked, setLocked] = useState(false);
  const [reliability, setReliability] = useState<'confirmed' | 'tentative'>('confirmed');
  const [extracting, setExtracting] = useState(false);
  const nodes = useLiveQuery(async () => {
    const rows = await db.nodes.where('bookId').equals(bookId).toArray();
    return rows.sort((a, b) => a.order - b.order);
  }, [bookId]) || [];

  const activeFacts = useMemo(() => sortFacts(facts.filter((fact) => fact.status === 'active')), [facts]);

  const resetDraft = () => {
    setEditingId(null);
    setStatement('');
    setCategory('custom');
    setTagsText('');
    setNotes('');
    setLocked(false);
    setReliability('confirmed');
  };

  const saveDraft = () => {
    const normalizedStatement = statement.trim();
    if (!normalizedStatement) {
      toast.warning('事实陈述不能为空');
      return;
    }

    const now = Date.now();
    const tags = tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 8);

    if (editingId) {
      const next = facts.map((fact) => (
        fact.id === editingId
          ? {
              ...fact,
              statement: normalizedStatement,
              category,
              tags,
              notes: notes.trim(),
              locked,
              reliability,
              updatedAt: now,
            }
          : fact
      ));
      onFactsChange(sortFacts(next));
      toast.success('事实已更新');
      resetDraft();
      return;
    }

    const entry: FactEntry = {
      id: createId(),
      bookId,
      category,
      statement: normalizedStatement,
      notes: notes.trim(),
      tags,
      reliability,
      locked,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    onFactsChange(sortFacts([entry, ...facts]));
    toast.success('事实已添加');
    resetDraft();
  };

  const editFact = (fact: FactEntry) => {
    setEditingId(fact.id);
    setStatement(fact.statement);
    setCategory(fact.category);
    setTagsText((fact.tags || []).join(', '));
    setNotes(fact.notes || '');
    setLocked(Boolean(fact.locked));
    setReliability(fact.reliability || 'confirmed');
  };

  const archiveFact = (factId: string) => {
    const next = facts.map((fact) => (
      fact.id === factId
        ? { ...fact, status: 'archived' as const, updatedAt: Date.now() }
        : fact
    ));
    onFactsChange(next);
    if (editingId === factId) resetDraft();
  };

  const toggleLock = (factId: string) => {
    const next = facts.map((fact) => (
      fact.id === factId
        ? { ...fact, locked: !fact.locked, updatedAt: Date.now() }
        : fact
    ));
    onFactsChange(sortFacts(next));
  };

  const extractCandidates = async () => {
    setExtracting(true);
    try {
      const nodes = await db.nodes.where('bookId').equals(bookId).toArray();
      const next = extractFactCandidatesFromNodes(bookId, nodes, facts, candidates);
      if (next.length === 0) {
        toast.info('没有识别到新的候选事实');
        return;
      }
      onCandidatesChange([...next, ...candidates].sort((a, b) => b.createdAt - a.createdAt));
      toast.success(`已抽取 ${next.length} 条候选事实`);
    } catch (error) {
      console.error(error);
      toast.error('自动抽取失败');
    } finally {
      setExtracting(false);
    }
  };

  const acceptCandidate = (candidate: FactCandidate, asLocked: boolean) => {
    const now = Date.now();
    const entry: FactEntry = {
      id: createId(),
      bookId,
      category: candidate.category,
      statement: candidate.statement.trim(),
      sourceNodeId: candidate.sourceNodeId,
      sourceExcerpt: candidate.sourceExcerpt,
      tags: [],
      notes: '',
      reliability: candidate.confidence >= 0.75 ? 'confirmed' : 'tentative',
      locked: asLocked,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const nextFacts = sortFacts([entry, ...facts]);
    onFactsChange(nextFacts);
    onCandidatesChange(candidates.filter((item) => item.id !== candidate.id));
    toast.success(asLocked ? '已转为锁定事实' : '已加入事实库');
  };

  const discardCandidate = (candidateId: string) => {
    onCandidatesChange(candidates.filter((candidate) => candidate.id !== candidateId));
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4 h-full">
      <div className="border border-border rounded-xl bg-secondary/20 p-3 min-h-[420px] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-foreground">事实库</div>
            <div className="text-[11px] text-muted-foreground mt-1">锁定事实会作为 AI 硬约束，禁止改写</div>
          </div>
          <button
            onClick={() => { void extractCandidates(); }}
            disabled={extracting}
            className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
          >
            {extracting ? '抽取中...' : '自动抽取候选'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin pr-1">
          {activeFacts.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-10 italic">
              暂无事实。你可以先手动添加，或用“自动抽取候选”从已写场景识别。
            </div>
          )}

          {activeFacts.map((fact) => (
            <div key={fact.id} className="border border-border rounded-lg p-2.5 bg-background/60">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  {FACT_CATEGORY_LABEL[fact.category]} · {fact.reliability === 'confirmed' ? '已确认' : '待确认'}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleLock(fact.id)}
                    className={`px-2 py-0.5 text-[10px] rounded ${fact.locked ? 'bg-red-500/10 text-red-500' : 'bg-secondary text-muted-foreground'}`}
                  >
                    {fact.locked ? '锁定' : '未锁定'}
                  </button>
                </div>
              </div>
              <div className="text-sm text-foreground mt-1 leading-6">{fact.statement}</div>
              {fact.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {fact.tags.map((tag) => (
                    <span key={`${fact.id}-${tag}`} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => editFact(fact)}
                  className="px-2 py-1 text-[11px] rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                >
                  编辑
                </button>
                <button
                  onClick={() => archiveFact(fact.id)}
                  className="px-2 py-1 text-[11px] rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4 min-h-[420px]">
        <div className="border border-border rounded-xl bg-secondary/20 p-3 space-y-2">
          <div className="text-sm font-semibold text-foreground">{editingId ? '编辑事实' : '新增事实'}</div>
          <textarea
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            className="w-full min-h-[90px] bg-input border border-border rounded px-2 py-2 text-sm text-foreground leading-6"
            placeholder="例如：林秋是霜港治安官。"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              分类
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as FactCategory)}
                className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
              >
                {CATEGORY_OPTIONS.map((item) => (
                  <option key={item} value={item}>{FACT_CATEGORY_LABEL[item]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
              可靠度
              <select
                value={reliability}
                onChange={(event) => setReliability(event.target.value as 'confirmed' | 'tentative')}
                className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
              >
                <option value="confirmed">已确认</option>
                <option value="tentative">待确认</option>
              </select>
            </label>
          </div>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            标签（逗号分隔）
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground"
              placeholder="角色, 身份, 世界规则"
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            备注
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="bg-input border border-border rounded px-2 py-1.5 text-xs text-foreground min-h-[70px]"
              placeholder="补充背景、证据来源等"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />
            设为锁定事实（AI 禁止改写）
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={saveDraft}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {editingId ? '保存事实' : '添加事实'}
            </button>
            <button
              onClick={resetDraft}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              清空
            </button>
          </div>

          {editingId && (
            <ReferenceLinksField
              bookId={bookId}
              entityType="fact"
              entityId={editingId}
              nodes={nodes}
            />
          )}
        </div>

        <div className="border border-border rounded-xl bg-secondary/20 p-3 h-[220px] flex flex-col">
          <div className="text-sm font-semibold text-foreground mb-2">候选事实（P2 自动抽取）</div>
          <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin pr-1">
            {candidates.length === 0 && (
              <div className="text-xs text-muted-foreground italic py-6 text-center">暂无候选事实</div>
            )}
            {candidates.map((candidate) => (
              <div key={candidate.id} className="border border-border rounded p-2 bg-background/50">
                <div className="text-[10px] text-muted-foreground">
                  {FACT_CATEGORY_LABEL[candidate.category]} · 置信度 {(candidate.confidence * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-foreground mt-1 leading-5">{candidate.statement}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => acceptCandidate(candidate, false)}
                    className="px-2 py-0.5 text-[10px] rounded bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    采纳
                  </button>
                  <button
                    onClick={() => acceptCandidate(candidate, true)}
                    className="px-2 py-0.5 text-[10px] rounded bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  >
                    采纳并锁定
                  </button>
                  <button
                    onClick={() => discardCandidate(candidate.id)}
                    className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground"
                  >
                    忽略
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
