import type { Book, ConsistencyFindingCategory, FactEntry, NodeType, SceneCharacterState, StoryNode } from '../types.ts';
import { detectLockedFactConflicts } from './factLibrary.ts';

export type FindingSeverity = 'high' | 'medium' | 'low';

export interface ConsistencyFinding {
  id: string;
  severity: FindingSeverity;
  category: ConsistencyFindingCategory;
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

const extractLexicalKeywords = (text: string) => {
  const lowered = text.toLowerCase();
  const tokens = lowered.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) || [];
  return new Set(tokens.slice(0, 120));
};

const jaccardSimilarity = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  a.forEach((token) => {
    if (b.has(token)) intersection += 1;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

type CharacterState = 'alive' | 'injured' | 'missing' | 'dead';

const detectCharacterState = (text: string): CharacterState | null => {
  if (/死亡|死去|身亡|尸体|被杀/i.test(text)) return 'dead';
  if (/失踪|下落不明|消失/i.test(text)) return 'missing';
  if (/受伤|负伤|流血|重创|昏迷/i.test(text)) return 'injured';
  if (/康复|痊愈|恢复意识|苏醒|活着/i.test(text)) return 'alive';
  return null;
};

const detectCharacterStateFromLedger = (state: SceneCharacterState): CharacterState | null => detectCharacterState([
  state.physicalState,
  state.note,
].filter(Boolean).join('\n'));

const buildCharacterStateMap = (characterStates: SceneCharacterState[]) => characterStates.reduce<Record<string, SceneCharacterState[]>>((acc, state) => {
  if (!acc[state.nodeId]) {
    acc[state.nodeId] = [];
  }
  acc[state.nodeId].push(state);
  return acc;
}, {});

const normalizePattern = (pattern: string) => pattern.trim().replace(/\s+/g, '');

export const runConsistencyCheck = (
  book: Book,
  nodes: StoryNode[],
  facts: FactEntry[] = [],
  characterStates: SceneCharacterState[] = []
): ConsistencyFinding[] => {
  const findings: ConsistencyFinding[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const characterStateMap = buildCharacterStateMap(characterStates);

  nodes.forEach((node) => {
    if (node.parentId && !nodeMap.has(node.parentId)) {
      findings.push({
        id: `orphan-${node.id}`,
        severity: 'high',
        category: 'structure',
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
        category: 'structure',
        title: '顶层节点类型异常',
        description: `顶层节点应为“卷”，但「${node.title}」类型为「${node.type}」。`,
        nodeId: node.id,
      });
    }
  });

  nodes.forEach((node) => {
    if (!node.parentId) return;
    const parent = nodeMap.get(node.parentId);
    if (!parent) return;

    const expectedChildType = EXPECTED_CHILD_TYPE[parent.type];
    if (expectedChildType && node.type !== expectedChildType) {
      findings.push({
        id: `type-chain-${node.id}`,
        severity: 'high',
        category: 'structure',
        title: '层级类型链不合法',
        description: `父节点「${parent.title}」应包含「${expectedChildType}」，但发现子节点「${node.title}」类型为「${node.type}」。`,
        nodeId: node.id,
      });
    }
  });

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
        category: 'structure',
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
        category: 'structure',
        title: '同级排序冲突',
        description: `同级节点存在相同排序值 order=${order}，会导致展示顺序不稳定。`,
        nodeId: bucket.find((node) => node.order === order)?.id,
      });
    });
  });

  const childCountByParent = new Map<string, number>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    childCountByParent.set(node.parentId, (childCountByParent.get(node.parentId) || 0) + 1);
  });

  nodes.filter((node) => node.type !== 'scene').forEach((node) => {
    const childCount = childCountByParent.get(node.id) || 0;
    if (childCount > 0) return;
    findings.push({
      id: `empty-struct-${node.id}`,
      severity: 'medium',
      category: 'structure',
      title: '结构节点缺少子节点',
      description: `「${node.title}」目前没有下一级内容。`,
      nodeId: node.id,
    });
  });

  nodes.filter((node) => node.type === 'scene' && node.status === 'drafted').forEach((node) => {
    const contentLength = (node.content || '').trim().length;
    if (contentLength >= 50) return;
    findings.push({
      id: `draft-empty-${node.id}`,
      severity: 'medium',
      category: 'metadata',
      title: '场景状态与内容不一致',
      description: `场景「${node.title}」标记为已起草，但正文过短或为空。`,
      nodeId: node.id,
    });
  });

  nodes.filter((node) => node.type === 'scene' && node.status === 'drafted').forEach((node) => {
    const meta = node.meta || {};
    const missingItems: string[] = [];
    if (!(meta.goal || '').trim()) missingItems.push('目标');
    if (!(meta.obstacle || '').trim()) missingItems.push('阻力');
    if (!(meta.turn || '').trim()) missingItems.push('转折');
    if (!(meta.outcome || '').trim()) missingItems.push('结果');
    if (missingItems.length === 0) return;
    findings.push({
      id: `scene-goal-card-${node.id}`,
      severity: 'medium',
      category: 'metadata',
      title: '场景目标卡未补全',
      description: `场景「${node.title}」缺少：${missingItems.join('、')}。建议补齐后再发布。`,
      nodeId: node.id,
    });
  });

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
        category: 'timeline',
        title: '时间线可能回退',
        description: `场景「${scene.title}」出现“第 ${currentDay} 天”，但前文已到“第 ${lastDay} 天”。请检查是否刻意倒叙。`,
        nodeId: scene.id,
      });
    }

    lastDay = currentDay;
  });

  const allSceneContent = linearScenes.map((scene) => `${scene.title}\n${scene.summary}\n${scene.content || ''}`).join('\n');

  book.characters.forEach((character, index) => {
    const name = character.name.trim();
    if (!name) return;

    const mentionCount = allSceneContent.split(name).length - 1;
    if (mentionCount === 0) {
      findings.push({
        id: `char-missing-${index}`,
        severity: 'low',
        category: 'character',
        title: '角色未出场',
        description: `角色「${name}」尚未在场景中出现，可检查是否遗漏铺垫。`,
      });
    } else if (mentionCount === 1) {
      findings.push({
        id: `char-weak-${index}`,
        severity: 'low',
        category: 'character',
        title: '角色出场偏少',
        description: `角色「${name}」当前仅出现 1 次，可评估是否需要加强存在感。`,
      });
    }

    const secret = character.secret.trim();
    if (secret.length >= 8 && allSceneContent.includes(secret)) {
      findings.push({
        id: `secret-leak-${index}`,
        severity: 'medium',
        category: 'character',
        title: '角色秘密可能提前泄露',
        description: `角色「${name}」的秘密文本疑似已出现在正文中，请确认是否符合你的揭示节奏。`,
      });
    }
  });

  const lastStateByCharacter = new Map<string, CharacterState>();
  const dayLocationByCharacter = new Map<string, string>();
  const locationConflictMemo = new Set<string>();
  linearScenes.forEach((scene) => {
    const sceneText = `${scene.title}\n${scene.summary}\n${scene.content || ''}`;
    const day = extractDayIndex(sceneText);
    const participants = new Set(scene.meta?.participants || []);
    const ledgerStates = characterStateMap[scene.id] || [];
    const ledgerByName = new Map(ledgerStates.map((state) => [state.characterName.trim(), state]));

    book.characters.forEach((character) => {
      const name = character.name.trim();
      if (!name) return;
      const ledgerState = ledgerByName.get(name);
      if (!participants.has(name) && !sceneText.includes(name) && !ledgerState) return;

      const detectedState = ledgerState ? detectCharacterStateFromLedger(ledgerState) : detectCharacterState(sceneText);
      if (detectedState) {
        const lastState = lastStateByCharacter.get(name);
        if (lastState === 'dead' && detectedState !== 'dead') {
          findings.push({
            id: `char-state-resurrection-${scene.id}-${name}`,
            severity: 'high',
            category: 'character',
            title: '角色状态机疑似冲突',
            description: `角色「${name}」此前已判定为死亡，但在场景「${scene.title}」中出现了“${detectedState}”状态，请确认是否有复活/回忆设定。`,
            nodeId: scene.id,
          });
        }
        lastStateByCharacter.set(name, detectedState);
      }

      const location = ledgerState?.location || scene.meta?.location || '';
      if (day !== null && location) {
        const dayKey = `${name}::${day}`;
        const knownLocation = dayLocationByCharacter.get(dayKey);
        if (!knownLocation) {
          dayLocationByCharacter.set(dayKey, location);
        } else if (knownLocation !== location) {
          const memoKey = `${dayKey}::${knownLocation}::${location}`;
          if (!locationConflictMemo.has(memoKey)) {
            locationConflictMemo.add(memoKey);
            findings.push({
              id: `char-location-conflict-${scene.id}-${name}`,
              severity: 'medium',
              category: 'timeline',
              title: '角色同日地点冲突',
              description: `角色「${name}」在“第 ${day} 天”出现了多个地点（${knownLocation} / ${location}），请确认时间线是否合理。`,
              nodeId: scene.id,
            });
          }
        }
      }
    });
  });

  linearScenes.forEach((scene) => {
    const summary = (scene.summary || '').trim();
    const content = (scene.content || '').trim();
    if (summary.length < 20 || content.length < 120) return;

    const summaryTokens = extractLexicalKeywords(summary);
    const contentTokens = extractLexicalKeywords(content.slice(0, 1200));
    const score = jaccardSimilarity(summaryTokens, contentTokens);
    if (score < 0.08) {
      findings.push({
        id: `outline-drift-${scene.id}`,
        severity: 'medium',
        category: 'metadata',
        title: '细纲与正文疑似偏离',
        description: `场景「${scene.title}」的摘要与正文关键词重合度较低（${(score * 100).toFixed(1)}%），建议检查是否跑题。`,
        nodeId: scene.id,
      });
    }
  });

  linearScenes.forEach((scene) => {
    const sceneText = `${scene.title}\n${scene.summary}\n${scene.content || ''}`;
    detectLockedFactConflicts(facts, sceneText).forEach((conflict, index) => {
      findings.push({
        id: `locked-fact-conflict-${scene.id}-${conflict.factId}-${index}`,
        severity: 'high',
        category: 'fact',
        title: '锁定事实疑似被改写',
        description: `场景「${scene.title}」可能与锁定事实冲突：${conflict.factStatement}（命中片段：${conflict.evidence}）`,
        nodeId: scene.id,
      });
    });
  });

  const bannedTerms = book.styleBible?.bannedTerms || [];
  if (bannedTerms.length > 0) {
    linearScenes.forEach((scene) => {
      const text = `${scene.title}\n${scene.summary}\n${scene.content || ''}`;
      const hit = bannedTerms.find((term) => term.trim() && text.includes(term.trim()));
      if (!hit) return;
      findings.push({
        id: `style-banned-term-${scene.id}-${normalizePattern(hit)}`,
        severity: 'medium',
        category: 'style',
        title: '命中禁用词',
        description: `场景「${scene.title}」出现了风格禁用词「${hit}」，建议统一文风后再发布。`,
        nodeId: scene.id,
      });
    });
  }

  const styleRules = (book.styleBible?.rules || '').trim();
  if (styleRules) {
    const prefersRestraint = /克制|冷静|简洁|简练|收敛|少感叹/.test(styleRules);
    if (prefersRestraint) {
      linearScenes.forEach((scene) => {
        const content = scene.content || '';
        const emphasisCount = (content.match(/[!！]{2,}|…{2,}|\?{2,}|？{2,}/g) || []).length;
        if (emphasisCount < 3) return;
        findings.push({
          id: `style-over-emphasis-${scene.id}`,
          severity: 'low',
          category: 'style',
          title: '文风强调符号偏多',
          description: `场景「${scene.title}」使用了较多感叹/省略等强调符号，可能与当前“克制/简洁”风格目标不一致。`,
          nodeId: scene.id,
        });
      });
    }
  }

  const sentencePatterns = (book.styleBible?.sentencePatterns || []).map(normalizePattern).filter(Boolean);
  if (sentencePatterns.length > 0) {
    const manuscript = linearScenes.map((scene) => `${scene.summary}\n${scene.content || ''}`).join('\n');
    const normalizedManuscript = normalizePattern(manuscript);
    sentencePatterns.forEach((pattern, index) => {
      if (normalizedManuscript.includes(pattern)) return;
      findings.push({
        id: `style-pattern-missing-${index}`,
        severity: 'low',
        category: 'style',
        title: '标志句式尚未落地',
        description: `风格设定中的句式「${book.styleBible?.sentencePatterns?.[index] || pattern}」尚未在正文中体现，可视情况补充。`,
      });
    });
  }

  return findings;
};
