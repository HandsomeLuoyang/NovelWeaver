import React, { useEffect, useState } from 'react';
import { Book } from '../types';
import { Icons } from './Icons';
import { motion } from 'framer-motion';
import { db } from '../db';

interface WritingStatsProps {
  book: Book;
}

interface DailyStats {
  date: string;
  wordCount: number;
}

export const WritingStats: React.FC<WritingStatsProps> = ({ book }) => {
  const [totalScenes, setTotalScenes] = useState(0);
  const [draftedScenes, setDraftedScenes] = useState(0);
  const [targetWordCount, setTargetWordCount] = useState(100000); // 默认10万字目标
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [tempTarget, setTempTarget] = useState(targetWordCount.toString());

  useEffect(() => {
    loadStats();
  }, [book.id]);

  const loadStats = async () => {
    const nodes = await db.nodes.where({ bookId: book.id }).toArray();
    const scenes = nodes.filter(n => n.type === 'scene');
    const drafted = scenes.filter(n => n.status === 'drafted');

    setTotalScenes(scenes.length);
    setDraftedScenes(drafted.length);
  };

  const currentWordCount = book.wordCount || 0;
  const progress = Math.min((currentWordCount / targetWordCount) * 100, 100);

  const handleSaveTarget = () => {
    const newTarget = parseInt(tempTarget) || 100000;
    setTargetWordCount(newTarget);
    setIsEditingTarget(false);
    // 这里可以保存到 book 的设置中
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/30 backdrop-blur-sm border border-border rounded-xl p-6 space-y-6"
    >
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Icons.BarChart3 className="w-5 h-5 text-primary" />
          写作统计
        </h3>
      </div>

      {/* 字数目标 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Icons.Target className="w-4 h-4 text-emerald-500" />
            <span className="text-muted-foreground">字数进度</span>
          </div>
          {isEditingTarget ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={tempTarget}
                onChange={(e) => setTempTarget(e.target.value)}
                className="w-24 px-2 py-1 text-xs border border-border rounded bg-background"
                autoFocus
              />
              <button
                onClick={handleSaveTarget}
                className="text-emerald-600 hover:text-emerald-700"
              >
                <Icons.Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setIsEditingTarget(false);
                  setTempTarget(targetWordCount.toString());
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
              {currentWordCount.toLocaleString()} / {targetWordCount.toLocaleString()}
            </button>
          )}
        </div>

        {/* 进度条 */}
        <div className="relative h-2 bg-secondary rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full"
          />
        </div>
        <div className="text-xs text-right text-muted-foreground">
          {progress.toFixed(1)}% 完成
        </div>
      </div>

      {/* 场景统计 */}
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

      {/* 角色数量 */}
      <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icons.Feather className="w-4 h-4" />
          角色数量
        </div>
        <div className="font-bold text-foreground">{book.characters.length}</div>
      </div>

      {/* 剩余字数提示 */}
      {currentWordCount < targetWordCount && (
        <div className="text-xs text-center text-muted-foreground border-t border-border pt-4">
          还需 {(targetWordCount - currentWordCount).toLocaleString()} 字完成目标
        </div>
      )}
    </motion.div>
  );
};
