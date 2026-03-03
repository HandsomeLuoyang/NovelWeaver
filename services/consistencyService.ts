import { Book, NodeType, StoryNode } from '../types';

export type FindingSeverity = 'high' | 'medium' | 'low';

export interface ConsistencyFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  nodeId?: string;
}

const EXPECTED_CHILD_TYPE: Record<NodeType, NodeType | null> = {
  volume: 'arc',
  arc: 'chapter',
  chapter: 'scene',
  scene: null,
};

const extractDayIndex = (text: string): number | null => {
  const patterns = [/第\s*(\d+)\s*天/i, /day\s*(\d+)/i, /d\s*(\d{1,3})\b/i];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }

  return null;
};

const buildLinearScenes = (nodes: StoryNode[]) => {
  const byParent = new Map<string | null, StoryNode[]>();
  nodes.forEach((node) => {
    const key = node.parentId;
    const bucket = byParent.get(key) || [];
    bucket.push(node);
    byParent.set(key, bucket);
  });

  byParent.forEach((bucket) => bucket.sort((a, b) => a.order - b.order));

  const walk = (parentId: string | null): StoryNode[] => {
    const children = byParent.get(parentId) || [];
    return children.flatMap((child) => {
      if (child.type === 'scene') return [child];
      return walk(child.id);
    });
  };

  return walk(null);
};

export const runConsistencyCheck = (book: Book, nodes: StoryNode[]): ConsistencyFinding[] => {
  const findings: ConsistencyFinding[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  // 1) Orphan nodes and invalid root node types
  nodes.forEach((node) => {
    if (node.parentId && !nodeMap.has(node.parentId)) {
      findings.push({
        id: `orphan-${node.id}`,
        severity: 'high',
        title: '检测到孤儿节点',
        description: `节点「${node.title}」的父节点不存在。`,
        nodeId: node.id,
      });
      return;
    }

    if (!node.parentId && node.type !== 'volume') {
      findings.push({
        id: `root-type-${node.id}`,
        severity: 'high',
        title: '顶层节点类型异常',
        description: `顶层节点应为“卷”，但「${node.title}」类型为「${node.type}」。`,
        nodeId: node.id,
      });
    }
  });

  // 2) Parent-child type integrity
  nodes.forEach((node) => {
    if (!node.parentId) return;
    const parent = nodeMap.get(node.parentId);
    if (!parent) return;

    const expectedChildType = EXPECTED_CHILD_TYPE[parent.type];
    if (expectedChildType && node.type !== expectedChildType) {
      findings.push({
        id: `type-chain-${node.id}`,
        severity: 'high',
        title: '层级类型链不合法',
        description: `父节点「${parent.title}」应包含「${expectedChildType}」，但发现子节点「${node.title}」类型为「${node.type}」。`,
        nodeId: node.id,
      });
    }
  });

  // 3) Duplicate sibling titles + duplicate order
  const siblingBuckets = new Map<string, StoryNode[]>();
  nodes.forEach((node) => {
    const key = `${node.parentId || 'root'}::${node.type}`;
    const bucket = siblingBuckets.get(key) || [];
    bucket.push(node);
    siblingBuckets.set(key, bucket);
  });

  siblingBuckets.forEach((bucket) => {
    const titleCount = new Map<string, number>();
    const orderCount = new Map<number, number>();

    bucket.forEach((node) => {
      titleCount.set(node.title, (titleCount.get(node.title) || 0) + 1);
      orderCount.set(node.order, (orderCount.get(node.order) || 0) + 1);
    });

    titleCount.forEach((count, title) => {
      if (count <= 1) return;
      findings.push({
        id: `dup-title-${bucket[0]?.id}-${title}`,
        severity: 'medium',
        title: '同级标题重复',
        description: `同一层级中标题「${title}」重复出现 ${count} 次。`,
        nodeId: bucket.find((node) => node.title === title)?.id,
      });
    });

    orderCount.forEach((count, order) => {
      if (count <= 1) return;
      findings.push({
        id: `dup-order-${bucket[0]?.id}-${order}`,
        severity: 'high',
        title: '同级排序冲突',
        description: `同级节点存在相同排序值 order=${order}，会导致展示顺序不稳定。`,
        nodeId: bucket.find((node) => node.order === order)?.id,
      });
    });
  });

  // 4) Empty structural nodes
  const childCountByParent = new Map<string, number>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    childCountByParent.set(node.parentId, (childCountByParent.get(node.parentId) || 0) + 1);
  });

  nodes
    .filter((node) => node.type !== 'scene')
    .forEach((node) => {
      const childCount = childCountByParent.get(node.id) || 0;
      if (childCount > 0) return;

      findings.push({
        id: `empty-struct-${node.id}`,
        severity: 'medium',
        title: '结构节点缺少子节点',
        description: `「${node.title}」目前没有下一级内容。`,
        nodeId: node.id,
      });
    });

  // 5) Draft status/content mismatch
  nodes
    .filter((node) => node.type === 'scene' && node.status === 'drafted')
    .forEach((node) => {
      const contentLength = (node.content || '').trim().length;
      if (contentLength >= 50) return;

      findings.push({
        id: `draft-empty-${node.id}`,
        severity: 'medium',
        title: '场景状态与内容不一致',
        description: `场景「${node.title}」标记为已起草，但正文过短或为空。`,
        nodeId: node.id,
      });
    });

  // 6) Timeline regression (heuristic by explicit day markers)
  const linearScenes = buildLinearScenes(nodes);
  let lastDay: number | null = null;
  linearScenes.forEach((scene) => {
    const markerSource = `${scene.title}\n${scene.summary}\n${scene.content || ''}`;
    const currentDay = extractDayIndex(markerSource);
    if (currentDay === null) return;

    if (lastDay !== null && currentDay < lastDay) {
      findings.push({
        id: `timeline-regression-${scene.id}`,
        severity: 'medium',
        title: '时间线可能回退',
        description: `场景「${scene.title}」出现“第 ${currentDay} 天”，但前文已到“第 ${lastDay} 天”。请检查是否刻意倒叙。`,
        nodeId: scene.id,
      });
    }

    lastDay = currentDay;
  });

  // 7) Character coverage and accidental secret leakage
  const allSceneContent = linearScenes
    .map((scene) => `${scene.title}\n${scene.summary}\n${scene.content || ''}`)
    .join('\n');

  book.characters.forEach((character, index) => {
    const name = character.name.trim();
    if (!name) return;

    const mentionCount = allSceneContent.split(name).length - 1;
    if (mentionCount === 0) {
      findings.push({
        id: `char-missing-${index}`,
        severity: 'low',
        title: '角色未出场',
        description: `角色「${name}」尚未在场景中出现，可检查是否遗漏铺垫。`,
      });
    } else if (mentionCount === 1) {
      findings.push({
        id: `char-weak-${index}`,
        severity: 'low',
        title: '角色出场偏少',
        description: `角色「${name}」当前仅出现 1 次，可评估是否需要加强存在感。`,
      });
    }

    const secret = character.secret.trim();
    if (secret.length >= 8 && allSceneContent.includes(secret)) {
      findings.push({
        id: `secret-leak-${index}`,
        severity: 'medium',
        title: '角色秘密可能提前泄露',
        description: `角色「${name}」的秘密文本疑似已出现在正文中，请确认是否符合你的揭示节奏。`,
      });
    }
  });

  return findings;
};
