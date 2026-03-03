import { Book, StoryNode } from '../types';

export type FindingSeverity = 'high' | 'medium' | 'low';

export interface ConsistencyFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  nodeId?: string;
}

export const runConsistencyCheck = (book: Book, nodes: StoryNode[]): ConsistencyFinding[] => {
  const findings: ConsistencyFinding[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 1) Orphan nodes
  nodes.forEach((node) => {
    if (node.parentId && !nodeMap.has(node.parentId)) {
      findings.push({
        id: `orphan-${node.id}`,
        severity: 'high',
        title: '检测到孤儿节点',
        description: `节点「${node.title}」的父节点不存在。`,
        nodeId: node.id,
      });
    }
  });

  // 2) Duplicate sibling titles
  const siblingBuckets = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const key = `${node.parentId || 'root'}::${node.type}`;
    const list = siblingBuckets.get(key) || [];
    list.push(node);
    siblingBuckets.set(key, list);
  });

  siblingBuckets.forEach((bucket) => {
    const titleCount = new Map<string, number>();
    bucket.forEach((n) => titleCount.set(n.title, (titleCount.get(n.title) || 0) + 1));
    titleCount.forEach((count, title) => {
      if (count > 1) {
        findings.push({
          id: `dup-${bucket[0]?.id}-${title}`,
          severity: 'medium',
          title: '同级标题重复',
          description: `同一层级中标题「${title}」重复出现 ${count} 次。`,
          nodeId: bucket.find((n) => n.title === title)?.id,
        });
      }
    });
  });

  // 3) Empty structural nodes
  nodes
    .filter((node) => node.type !== 'scene')
    .forEach((node) => {
      const childCount = nodes.filter((n) => n.parentId === node.id).length;
      if (childCount === 0) {
        findings.push({
          id: `empty-struct-${node.id}`,
          severity: 'medium',
          title: '结构节点缺少子节点',
          description: `「${node.title}」目前没有下一级内容。`,
          nodeId: node.id,
        });
      }
    });

  // 4) Draft status but no content
  nodes
    .filter((node) => node.type === 'scene' && node.status === 'drafted')
    .forEach((node) => {
      if (!node.content || node.content.trim().length < 50) {
        findings.push({
          id: `draft-empty-${node.id}`,
          severity: 'medium',
          title: '场景状态与内容不一致',
          description: `场景「${node.title}」标记为已起草，但正文过短或为空。`,
          nodeId: node.id,
        });
      }
    });

  // 5) Characters never mentioned
  const allContent = nodes
    .filter((node) => node.type === 'scene')
    .map((node) => `${node.title}\n${node.summary}\n${node.content || ''}`)
    .join('\n');

  book.characters.forEach((char, index) => {
    if (!char.name) return;
    if (!allContent.includes(char.name)) {
      findings.push({
        id: `char-missing-${index}`,
        severity: 'low',
        title: '角色未出场',
        description: `角色「${char.name}」尚未在场景中出现，可检查是否遗漏铺垫。`,
      });
    }
  });

  return findings;
};
