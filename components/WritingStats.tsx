import React, { useEffect, useMemo, useState } from 'react';
import { Book } from '../types';
import { Icons } from './Icons';
import { motion } from 'framer-motion';
import { db } from '../db';
import { useStore } from '../store';

interface WritingStatsProps {
  book: Book;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

export const WritingStats: React.FC<WritingStatsProps> = ({ book }) => {
  const { writingGoals, setWritingGoal } = useStore();
  const [totalScenes, setTotalScenes] = useState(0);
  const [draftedScenes, setDraftedScenes] = useState(0);
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [tempTotalTarget, setTempTotalTarget] = useState('100000');
  const [tempDailyTarget, setTempDailyTarget] = useState('2000');
  const [tempTargetDate, setTempTargetDate] = useState('');

  const goal = writingGoals[book.id] || {
    bookId: book.id,
    totalTargetWords: 100000,
    dailyTargetWords: 2000,
    targetDate: '',
    dailyBaselineDate: todayKey(),
    dailyBaselineWordCount: book.wordCount || 0,
  };

  useEffect(() => {
    loadStats();
  }, [book.id]);

  useEffect(() => {
    if (!writingGoals[book.id]) {
      setWritingGoal(book.id, {
        totalTargetWords: 100000,
        dailyTargetWords: 2000,
        dailyBaselineDate: todayKey(),
        dailyBaselineWordCount: book.wordCount || 0,
      });
    }
  }, [book.id, book.wordCount, setWritingGoal, writingGoals]);

  useEffect(() => {
    const today = todayKey();
    if (goal.dailyBaselineDate !== today) {
      setWritingGoal(book.id, {
        dailyBaselineDate: today,
        dailyBaselineWordCount: book.wordCount || 0,
      });
    }
    setTempTotalTarget(String(goal.totalTargetWords));
    setTempDailyTarget(String(goal.dailyTargetWords));
    setTempTargetDate(goal.targetDate || '');
  }, [book.id, book.wordCount, goal.dailyBaselineDate, goal.dailyTargetWords, goal.targetDate, goal.totalTargetWords, setWritingGoal]);

  const loadStats = async () => {
    const nodes = await db.nodes.where({ bookId: book.id }).toArray();
    const scenes = nodes.filter((n) => n.type === 'scene');
    const drafted = scenes.filter((n) => n.status === 'drafted');

    setTotalScenes(scenes.length);
    setDraftedScenes(drafted.length);
  };

  const currentWordCount = book.wordCount || 0;
  const totalProgress = Math.min((currentWordCount / goal.totalTargetWords) * 100, 100);
  const todayWordDelta = Math.max(0, currentWordCount - goal.dailyBaselineWordCount);
  const dailyProgress = Math.min((todayWordDelta / goal.dailyTargetWords) * 100, 100);

  const burnDownInfo = useMemo(() => {
    if (!goal.targetDate) return null;

    const target = new Date(goal.targetDate);
    const today = new Date();
    target.setHours(23, 59, 59, 999);
    const daysLeft = Math.max(1, Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
    const remaining = Math.max(0, goal.totalTargetWords - currentWordCount);
    const requiredDaily = Math.ceil(remaining / daysLeft);

    return {
      daysLeft,
      requiredDaily,
      onTrack: requiredDaily <= goal.dailyTargetWords,
    };
  }, [goal.targetDate, goal.totalTargetWords, goal.dailyTargetWords, currentWordCount]);

  const handleSaveTarget = () => {
    setWritingGoal(book.id, {
      totalTargetWords: Math.max(1000, parseInt(tempTotalTarget, 10) || 100000),
      dailyTargetWords: Math.max(100, parseInt(tempDailyTarget, 10) || 2000),
      targetDate: tempTargetDate || undefined,
    });
    setIsEditingTarget(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/30 backdrop-blur-sm border border-border rounded-xl p-6 space-y-6"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Icons.BarChart3 className="w-5 h-5 text-primary" />
          写作统计与目标
        </h3>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Icons.Target className="w-4 h-4 text-emerald-500" />
            <span className="text-muted-foreground">总字数进度</span>
          </div>
          {isEditingTarget ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={tempTotalTarget}
                onChange={(e) => setTempTotalTarget(e.target.value)}
                className="w-24 px-2 py-1 text-xs border border-border rounded bg-background"
                autoFocus
              />
              <button onClick={handleSaveTarget} className="text-emerald-600 hover:text-emerald-700">
                <Icons.Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsEditingTarget(false);
                  setTempTotalTarget(String(goal.totalTargetWords));
                  setTempDailyTarget(String(goal.dailyTargetWords));
                  setTempTargetDate(goal.targetDate || '');
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingTarget(true)}
              className="font-mono font-medium text-foreground hover:text-primary"
            >
              {currentWordCount.toLocaleString()} / {goal.totalTargetWords.toLocaleString()}
            </button>
          )}
        </div>

        <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${totalProgress}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
          />
        </div>
        <div className="text-xs text-right text-muted-foreground">{totalProgress.toFixed(1)}% 完成</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">今日目标进度</span>
          <span className="font-mono text-foreground">{todayWordDelta.toLocaleString()} / {goal.dailyTargetWords.toLocaleString()}</span>
        </div>
        <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${dailyProgress}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-cyan-600 rounded-full"
          />
        </div>
      </div>

      {isEditingTarget && (
        <div className="rounded-lg border border-border bg-secondary/30 p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            每日目标字数
            <input
              type="number"
              value={tempDailyTarget}
              onChange={(e) => setTempDailyTarget(e.target.value)}
              className="px-2 py-1 text-xs border border-border rounded bg-background text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            完稿日期
            <input
              type="date"
              value={tempTargetDate}
              onChange={(e) => setTempTargetDate(e.target.value)}
              className="px-2 py-1 text-xs border border-border rounded bg-background text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            今日基线字数
            <input
              type="number"
              value={goal.dailyBaselineWordCount}
              onChange={(e) => setWritingGoal(book.id, { dailyBaselineWordCount: Number(e.target.value) || 0 })}
              className="px-2 py-1 text-xs border border-border rounded bg-background text-foreground"
            />
          </label>
        </div>
      )}

      {burnDownInfo && (
        <div className="p-3 rounded-lg border border-border bg-secondary/30 text-xs text-muted-foreground space-y-1">
          <div>距离完稿日期还有 {burnDownInfo.daysLeft} 天</div>
          <div>按期完稿需日均 {burnDownInfo.requiredDaily.toLocaleString()} 字</div>
          <div className={burnDownInfo.onTrack ? 'text-emerald-500' : 'text-amber-500'}>
            {burnDownInfo.onTrack ? '当前目标节奏可达成' : '当前节奏偏慢，建议提高每日目标'}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <div className="text-2xl font-bold text-foreground">{totalScenes}</div>
          <div className="text-xs text-muted-foreground">总场景数</div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <div className="text-2xl font-bold text-emerald-600">{draftedScenes}</div>
          <div className="text-xs text-muted-foreground">已完成</div>
        </div>
      </div>

      <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icons.Feather className="w-4 h-4" />
          角色数量
        </div>
        <div className="font-bold text-foreground">{book.characters.length}</div>
      </div>

      {currentWordCount < goal.totalTargetWords && (
        <div className="text-xs text-center text-muted-foreground border-t border-border pt-4">
          还需 {(goal.totalTargetWords - currentWordCount).toLocaleString()} 字完成总目标
        </div>
      )}
    </motion.div>
  );
};
