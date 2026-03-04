import { FactCandidate, FactCategory, FactEntry, StoryNode } from '../types';

export const FACT_CATEGORY_LABEL: Record<FactCategory, string> = {
  world: '世界',
  character: '角色',
  timeline: '时间线',
  rule: '规则',
  location: '地点',
  item: '道具',
  event: '事件',
  custom: '自定义',
};

const guessFactCategory = (statement: string): FactCategory => {
  if (/第\s*\d+\s*天|年|月|日|清晨|夜里|凌晨/i.test(statement)) return 'timeline';
  if (/位于|在.*城|宫|镇|港|站|岛|山|河|国|洲/i.test(statement)) return 'location';
  if (/规则|法则|必须|禁止|不可|代价|限制/i.test(statement)) return 'rule';
  if (/武器|钥匙|戒指|遗物|神器|芯片|代码|药剂/i.test(statement)) return 'item';
  if (/角色|主角|反派|导师|妹妹|哥哥|父亲|母亲|队长|警官|医生/i.test(statement)) return 'character';
  if (/战争|叛乱|灾变|事故|事件|袭击|审判|比赛/i.test(statement)) return 'event';
  if (/世界|王朝|文明|科技|魔法|修真|异能/i.test(statement)) return 'world';
  return 'custom';
};

const extractSentenceCandidates = (text: string) => {
  return text
    .split(/[。！？!?;\n]/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 10 && line.length <= 80)
    .filter((line) => /是|位于|来自|属于|必须|禁止|拥有|发生在|身份|关系|秘密/.test(line));
};

const normalizeStatement = (statement: string) => statement.replace(/\s+/g, ' ').trim();

const factKey = (statement: string) => normalizeStatement(statement).toLowerCase();

export const buildFactPromptContext = (facts: FactEntry[]) => {
  const active = facts.filter((fact) => fact.status === 'active');
  const locked = active.filter((fact) => fact.locked);
  const unlocked = active.filter((fact) => !fact.locked);

  const format = (list: FactEntry[]) => {
    if (list.length === 0) return '（无）';
    return list
      .slice(0, 40)
      .map((fact, index) => `${index + 1}. [${FACT_CATEGORY_LABEL[fact.category]}] ${fact.statement}`)
      .join('\n');
  };

  return {
    activeCount: active.length,
    lockedCount: locked.length,
    factHardConstraints: locked.length === 0
      ? '（当前无锁定事实）'
      : `以下为锁定事实，禁止改写、否认或无依据推翻：\n${format(locked)}`,
    factSoftContext: unlocked.length === 0
      ? '（当前无补充事实）'
      : `以下为可参考事实，可在不冲突前提下灵活使用：\n${format(unlocked)}`,
    factSummary: active.length === 0
      ? '当前事实库为空'
      : `事实库共 ${active.length} 条（锁定 ${locked.length} 条）`,
  };
};

export interface LockedFactConflict {
  factId: string;
  factStatement: string;
  evidence: string;
}

const parseStatement = (statement: string) => {
  const normalized = normalizeStatement(statement);
  const connectors = ['是', '位于', '来自', '属于', '担任', '拥有', '发生在'];

  for (const connector of connectors) {
    const index = normalized.indexOf(connector);
    if (index <= 0 || index >= normalized.length - connector.length) continue;
    const subject = normalized.slice(0, index).trim();
    const object = normalized.slice(index + connector.length).trim();
    if (subject.length === 0 || object.length === 0) continue;
    return { connector, subject, object };
  }

  return null;
};

const escapeRegex = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildNegationPattern = (subject: string, object: string) => {
  const s = escapeRegex(subject);
  const o = escapeRegex(object);
  return new RegExp(`${s}.{0,12}(不是|并非|不再是|并不是|没有|不存在|不属于|并不属于).{0,8}${o}`);
};

export const detectLockedFactConflicts = (facts: FactEntry[], text: string): LockedFactConflict[] => {
  const source = normalizeStatement(text);
  if (!source) return [];

  const conflicts: LockedFactConflict[] = [];

  facts
    .filter((fact) => fact.locked && fact.status === 'active')
    .forEach((fact) => {
      const parsed = parseStatement(fact.statement);
      if (!parsed) return;

      const { subject, object } = parsed;
      if (!source.includes(subject)) return;

      const pattern = buildNegationPattern(subject, object);
      const match = source.match(pattern);
      if (!match) return;

      conflicts.push({
        factId: fact.id,
        factStatement: fact.statement,
        evidence: match[0].slice(0, 80),
      });
    });

  return conflicts;
};

export const extractFactCandidatesFromNodes = (
  bookId: string,
  nodes: StoryNode[],
  existingFacts: FactEntry[],
  existingCandidates: FactCandidate[] = []
): FactCandidate[] => {
  const existingKeys = new Set<string>();
  existingFacts.forEach((fact) => existingKeys.add(factKey(fact.statement)));
  existingCandidates.forEach((candidate) => existingKeys.add(factKey(candidate.statement)));

  const candidates: FactCandidate[] = [];
  const now = Date.now();

  nodes
    .filter((node) => node.type === 'scene')
    .forEach((node) => {
      const source = `${node.summary || ''}\n${node.content || ''}`;
      if (!source.trim()) return;

      const lines = extractSentenceCandidates(source);
      lines.forEach((line, index) => {
        const statement = normalizeStatement(line);
        const key = factKey(statement);
        if (!statement || existingKeys.has(key)) return;

        existingKeys.add(key);
        candidates.push({
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random()}-${index}`,
          bookId,
          category: guessFactCategory(statement),
          statement,
          sourceNodeId: node.id,
          sourceExcerpt: statement.slice(0, 120),
          confidence: Math.min(0.95, 0.55 + Math.min(0.35, statement.length / 200)),
          createdAt: now,
        });
      });
    });

  return candidates.slice(0, 200);
};
