import { MaterialEntry, MaterialType } from '../types';

export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  snippet: '片段',
  idea: '创意',
  reference: '参考',
  note: '笔记',
};

const tokenize = (text: string) => {
  const lowered = text.toLowerCase();
  const tokens = lowered.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) || [];
  const expanded: string[] = [];
  tokens.forEach((token) => {
    expanded.push(token);
    if (/^[\u4e00-\u9fa5]+$/.test(token) && token.length >= 4) {
      for (let i = 0; i <= token.length - 2; i += 1) {
        expanded.push(token.slice(i, i + 2));
      }
    }
  });
  return Array.from(new Set(expanded));
};

const scoreMaterial = (entry: MaterialEntry, queryTokens: string[]) => {
  if (queryTokens.length === 0) return 0;
  const title = (entry.title || '').toLowerCase();
  const content = (entry.content || '').toLowerCase();
  const tags = (entry.tags || []).map((tag) => tag.toLowerCase());
  const source = (entry.source || '').toLowerCase();
  let score = 0;

  queryTokens.forEach((token) => {
    if (title.includes(token)) score += 3;
    if (tags.some((tag) => tag.includes(token))) score += 2;
    if (source.includes(token)) score += 1.5;
    if (content.includes(token)) score += 1;
  });

  return score;
};

const excerpt = (text: string, max = 220) => {
  const trimmed = (text || '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
};

export interface MaterialPromptContext {
  materialSummary: string;
  materialContext: string;
  selected: MaterialEntry[];
}

export const buildMaterialPromptContext = (
  materials: MaterialEntry[],
  query: string,
  limit = 4
): MaterialPromptContext => {
  const normalized = materials.filter((entry) => (entry.title || '').trim() && (entry.content || '').trim());
  if (normalized.length === 0) {
    return {
      materialSummary: '素材库为空',
      materialContext: '（暂无素材，可在素材库中补充灵感片段、参考设定或写作笔记）',
      selected: [],
    };
  }

  const queryTokens = tokenize(query).slice(0, 24);
  const selected = (queryTokens.length === 0
    ? [...normalized].sort((a, b) => b.updatedAt - a.updatedAt)
    : [...normalized].sort((a, b) => {
        const delta = scoreMaterial(b, queryTokens) - scoreMaterial(a, queryTokens);
        if (delta !== 0) return delta;
        return b.updatedAt - a.updatedAt;
      }))
    .slice(0, Math.max(1, Math.min(8, limit)));

  const materialContext = selected
    .map((entry, index) => {
      const tags = (entry.tags || []).length > 0 ? ` | 标签: ${entry.tags.join('、')}` : '';
      const source = entry.source ? ` | 来源: ${entry.source}` : '';
      return `${index + 1}. [${MATERIAL_TYPE_LABEL[entry.type]}] ${entry.title}${tags}${source}\n${excerpt(entry.content)}`;
    })
    .join('\n\n');

  return {
    materialSummary: `素材库共 ${normalized.length} 条，已注入 ${selected.length} 条相关素材`,
    materialContext,
    selected,
  };
};
