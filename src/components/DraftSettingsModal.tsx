import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './Icons';
import { DraftCreativeMode, DraftGenerationSettings } from '../types';

interface DraftSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (settings: DraftGenerationSettings) => void;
}

export const DraftSettingsModal: React.FC<DraftSettingsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [contextLimit, setContextLimit] = useState(5);
  const [creativeMode, setCreativeMode] = useState<DraftCreativeMode>('balanced');
  const [antiBlock, setAntiBlock] = useState(true);

  const handleConfirm = () => {
    onConfirm({
      contextLimit,
      creativeMode,
      antiBlock,
    });
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200 dark:border-gray-700"
        >
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Icons.Sparkles className="w-5 h-5 text-purple-600" />
              一键草稿设置
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                上文回顾范围 (场景数)
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="1"
                  value={contextLimit}
                  onChange={(e) => setContextLimit(Number(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-purple-600"
                />
                <span className="w-8 text-center font-mono font-bold text-purple-600 dark:text-purple-400">
                  {contextLimit}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                AI 将读取最近的 {contextLimit} 个场景作为连贯性参考。
                <br/>场景越多，记忆越长，但消耗 Token 越多。
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                创作模式
              </label>
              <select
                value={creativeMode}
                onChange={(e) => setCreativeMode(e.target.value as DraftCreativeMode)}
                className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded p-2 text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="balanced">平衡推进</option>
                <option value="divergent">发散灵感</option>
                <option value="twist">反转驱动</option>
                <option value="conflict">冲突升级</option>
                <option value="dialogue">对白推进</option>
              </select>
            </div>

            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={antiBlock}
                onChange={(e) => setAntiBlock(e.target.checked)}
                className="mt-1"
              />
              <span>
                启用防卡文推进
                <span className="block text-xs text-gray-500 mt-1">
                  AI 会强制给出可执行推进动作、冲突升级点和下一步悬念。
                </span>
              </span>
            </label>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-900/50">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium flex items-center gap-2"
            >
              <Icons.Wand className="w-4 h-4" />
              开始生成
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
};
