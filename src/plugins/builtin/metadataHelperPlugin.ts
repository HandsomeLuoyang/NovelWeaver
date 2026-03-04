import { db } from '../../db';
import { NovelWeaverPlugin } from '../types';

const inferConflictType = (text: string) => {
  const lowered = text.toLowerCase();
  if (/(战斗|对决|追杀|冲突|决战)/.test(text)) return '对抗';
  if (/(调查|线索|谜题|真相|推理)/.test(text)) return '解谜';
  if (/(自责|恐惧|挣扎|回忆|犹豫)/.test(text)) return '内心';
  if (/(谈判|交易|协商|争执)/.test(text)) return '博弈';
  if (lowered.includes('flashback')) return '倒叙';
  return '复合';
};

export const metadataHelperPlugin: NovelWeaverPlugin = {
  id: 'builtin.metadata-helper',
  name: 'Metadata Helper',
  version: '1.0.0',
  description: '自动提取场景元数据（参与角色与冲突类型）',
  actions: [
    {
      id: 'metadata.extractParticipants',
      title: '提取当前场景参与角色',
      description: '根据正文与摘要自动匹配角色名并回填到场景元数据',
      run: async ({ currentBook, currentNode }) => {
        if (!currentBook || !currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const source = `${currentNode.title}\n${currentNode.summary}\n${currentNode.content || ''}`;
        const participants = currentBook.characters
          .map((character) => character.name.trim())
          .filter((name) => name.length > 0 && source.includes(name));

        await db.nodes.update(currentNode.id, {
          meta: {
            ...(currentNode.meta || {}),
            participants: Array.from(new Set(participants)),
          },
        });

        return { message: `已提取 ${participants.length} 位参与角色。` };
      },
    },
    {
      id: 'metadata.inferConflictType',
      title: '推断当前场景冲突类型',
      description: '根据标题/摘要/正文关键词自动填充冲突类型',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const source = `${currentNode.title}\n${currentNode.summary}\n${currentNode.content || ''}`;
        const conflictType = inferConflictType(source);

        await db.nodes.update(currentNode.id, {
          meta: {
            ...(currentNode.meta || {}),
            conflictType,
          },
        });

        return { message: `已更新冲突类型：${conflictType}` };
      },
    },
  ],
};
