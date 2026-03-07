import { db, updateBookWordCount } from '../../db';
import { NovelWeaverPlugin } from '../types';

const splitParagraph = (paragraph: string) => {
  if (paragraph.length <= 140) return [paragraph];
  const segments: string[] = [];
  let current = '';
  paragraph.split(/(?<=[。！？；])/).forEach((piece) => {
    const next = `${current}${piece}`;
    if (next.length > 140 && current.trim()) {
      segments.push(current.trim());
      current = piece;
      return;
    }
    current = next;
  });
  if (current.trim()) segments.push(current.trim());
  return segments.length > 0 ? segments : [paragraph];
};

const SENSORY_TEMPLATE = `【感官补丁】
- 视觉：现场最先映入眼帘的细节是什么？
- 听觉：什么声音让场面更有压迫感？
- 触觉：角色身体最直接感受到什么？
- 气味/温度：环境如何作用到情绪？`;

export const styleToolkitPlugin: NovelWeaverPlugin = {
  id: 'builtin.style-toolkit',
  name: 'Style Toolkit',
  version: '1.0.0',
  category: 'review',
  description: '文风与可读性助手：拆长段、补感官描写模板',
  actions: [
    {
      id: 'style.splitLongParagraphs',
      title: '拆分过长段落',
      description: '把超长段落拆成更易读的段落，适合网文阅读节奏。',
      requires: ['scene'],
      contextHint: '需要当前选中一个场景节点。',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene' || !(currentNode.content || '').trim()) {
          return { message: '请先选中一个有正文的场景。' };
        }

        const paragraphs = (currentNode.content || '').split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
        const nextParagraphs = paragraphs.flatMap(splitParagraph);
        const changed = nextParagraphs.length - paragraphs.length;
        if (changed <= 0) {
          return { message: '当前正文段落长度较均衡，无需拆分。' };
        }

        await db.nodes.update(currentNode.id, { content: nextParagraphs.join('\n\n') });
        await updateBookWordCount(currentNode.bookId);
        return { message: `已拆分 ${changed} 段长段落。` };
      },
    },
    {
      id: 'style.insertSensoryTemplate',
      title: '插入感官描写模板',
      description: '为当前场景插入视觉/听觉/触觉检查清单，避免写面谱化。',
      requires: ['scene'],
      contextHint: '需要当前选中一个场景节点。',
      run: async ({ currentNode }) => {
        if (!currentNode || currentNode.type !== 'scene') {
          return { message: '请先选中一个场景节点。' };
        }
        const content = currentNode.content || '';
        if (content.includes('【感官补丁】')) {
          return { message: '当前场景已包含感官补丁模板。' };
        }
        const nextContent = content.trim() ? `${content.trim()}\n\n${SENSORY_TEMPLATE}` : SENSORY_TEMPLATE;
        await db.nodes.update(currentNode.id, { content: nextContent });
        await updateBookWordCount(currentNode.bookId);
        return { message: '已插入感官描写模板。' };
      },
    },
  ],
};
