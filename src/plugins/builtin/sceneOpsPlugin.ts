import { db } from '../../db';
import { NodeStatus } from '../../types';
import { NovelWeaverPlugin } from '../types';

const inferStatusByContent = (content?: string): NodeStatus => {
  const length = (content || '').trim().length;
  if (length >= 800) return 'drafted';
  if (length >= 80) return 'outlined';
  return 'empty';
};

const extractSummaryFromContent = (content: string) => {
  const normalized = content
    .replace(/^#+\s*/gm, '')
    .replace(/[`>*_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';
  const sliced = normalized.slice(0, 120);
  return normalized.length > 120 ? `${sliced}...` : sliced;
};

const SCENE_BEAT_TEMPLATE = `【场景目标】
- 主角要达成什么？

【场景冲突】
- 谁在阻止主角？障碍是什么？

【场景转折】
- 中段发生了什么变化？

【场景结果】
- 本场景结束后，局势如何改变？`;

export const sceneOpsPlugin: NovelWeaverPlugin = {
  id: 'builtin.scene-ops',
  name: 'Scene Ops',
  version: '1.0.0',
  category: 'writing',
  description: '场景效率工具：状态校准、摘要同步、节奏模板注入',
  actions: [
    {
      id: 'scene.syncStatusByLength',
      title: '按内容长度同步场景状态',
      description: '根据正文长度自动设置 empty / outlined / drafted',
      requires: ['scene'],
      contextHint: '需要当前选中一个场景节点。',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const status = inferStatusByContent(currentNode.content);
        await db.nodes.update(currentNode.id, { status });
        return { message: `已同步状态为：${status}` };
      },
    },
    {
      id: 'scene.syncSummaryFromContent',
      title: '用正文首段更新摘要',
      description: '从正文提取简短摘要并回填到当前场景摘要',
      requires: ['scene'],
      contextHint: '需要当前选中一个场景节点。',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const summary = extractSummaryFromContent(currentNode.content || '');
        if (!summary) {
          return { message: '正文为空，无法提取摘要。' };
        }

        await db.nodes.update(currentNode.id, { summary });
        return { message: '已根据正文更新场景摘要。' };
      },
    },
    {
      id: 'scene.insertBeatTemplate',
      title: '插入场景节奏模板',
      description: '为当前场景注入目标/冲突/转折/结果模板',
      requires: ['scene'],
      contextHint: '需要当前选中一个场景节点。',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const current = currentNode.content || '';
        if (current.includes('【场景目标】') && current.includes('【场景冲突】')) {
          return { message: '当前场景已包含节奏模板。' };
        }

        const nextContent = current.trim()
          ? `${current.trim()}\n\n${SCENE_BEAT_TEMPLATE}`
          : SCENE_BEAT_TEMPLATE;
        const status = inferStatusByContent(nextContent);

        await db.nodes.update(currentNode.id, {
          content: nextContent,
          status,
        });
        return { message: '已插入场景节奏模板。' };
      },
    },
  ],
};
