import { db } from '../../db';
import { NovelWeaverPlugin } from '../types';

const inferTimeTag = (text: string) => {
  const compact = text.replace(/\s+/g, ' ');
  const dayMatch = compact.match(/第\s*\d+\s*天/);
  if (dayMatch) return dayMatch[0].replace(/\s+/g, '');

  if (/(黎明|拂晓|天亮|清晨|早晨)/.test(compact)) return '清晨';
  if (/(正午|中午|午后)/.test(compact)) return '白天';
  if (/(黄昏|傍晚|日落)/.test(compact)) return '黄昏';
  if (/(深夜|午夜|夜里|夜晚)/.test(compact)) return '夜晚';
  return '';
};

const inferLocation = (text: string) => {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const explicit = lines.find((line) => /^地点[:：]/.test(line));
  if (explicit) return explicit.replace(/^地点[:：]\s*/, '').slice(0, 24);

  const inline = text.match(/(?:在|于|来到|抵达)([^，。；\n]{2,20})(?:[，。；\n]|$)/);
  return inline?.[1]?.trim() || '';
};

const inferTags = (text: string) => {
  const source = text.toLowerCase();
  const rules: Array<{ tag: string; pattern: RegExp }> = [
    { tag: '战斗', pattern: /(战斗|对决|交锋|追杀|厮杀)/i },
    { tag: '调查', pattern: /(调查|线索|谜题|推理|真相)/i },
    { tag: '情感', pattern: /(告白|心动|争执|和解|别离)/i },
    { tag: '政治', pattern: /(谈判|交易|协商|权力|派系)/i },
    { tag: '回忆', pattern: /(回忆|往事|童年|闪回|flashback)/i },
    { tag: '悬疑', pattern: /(疑点|异样|诡异|悬念|伏笔)/i },
  ];

  return rules
    .filter((rule) => rule.pattern.test(source))
    .map((rule) => rule.tag)
    .slice(0, 5);
};

export const continuityToolkitPlugin: NovelWeaverPlugin = {
  id: 'builtin.continuity-toolkit',
  name: 'Continuity Toolkit',
  version: '1.0.0',
  description: '连贯性助手：时间/地点推断与场景标签自动归类',
  actions: [
    {
      id: 'continuity.inferTimeAndLocation',
      title: '推断时间与地点标签',
      description: '基于标题/摘要/正文推断 timeTag 与 location',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const source = `${currentNode.title}\n${currentNode.summary}\n${currentNode.content || ''}`;
        const timeTag = inferTimeTag(source);
        const location = inferLocation(source);

        if (!timeTag && !location) {
          return { message: '未命中明显的时间或地点线索。' };
        }

        await db.nodes.update(currentNode.id, {
          meta: {
            ...(currentNode.meta || {}),
            ...(timeTag ? { timeTag } : {}),
            ...(location ? { location } : {}),
          },
        });

        const desc = [timeTag ? `时间=${timeTag}` : '', location ? `地点=${location}` : '']
          .filter(Boolean)
          .join('，');
        return { message: `已更新：${desc}` };
      },
    },
    {
      id: 'continuity.autoTagScene',
      title: '自动打场景标签',
      description: '按关键词自动生成 scene tags（战斗/调查/情感等）',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点再执行。' };
        }

        const source = `${currentNode.title}\n${currentNode.summary}\n${currentNode.content || ''}`;
        const inferredTags = inferTags(source);
        if (inferredTags.length === 0) {
          return { message: '未识别到可归类的场景标签。' };
        }

        const mergedTags = Array.from(new Set([...(currentNode.meta?.tags || []), ...inferredTags]));
        await db.nodes.update(currentNode.id, {
          meta: {
            ...(currentNode.meta || {}),
            tags: mergedTags,
          },
        });

        return { message: `已更新标签：${mergedTags.join('、')}` };
      },
    },
  ],
};
