import { Book } from '../types';
import { db, getAncestors, getLinearContext, getSceneCharacterStates, getSemanticContext } from '../db';

export interface ProjectQaSource {
  label: string;
  nodeId?: string;
}

export interface ProjectQaContextResult {
  context: string;
  sources: ProjectQaSource[];
}

const extractKeywords = (text: string) => Array.from(new Set(
  (text.toLowerCase().match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) || []).slice(0, 12)
));

const scoreByKeywords = (text: string, keywords: string[]) => keywords.reduce((score, keyword) => (
  text.toLowerCase().includes(keyword) ? score + 1 : score
), 0);

export const buildProjectQaContext = async (
  book: Book,
  query: string,
  activeNodeId: string | null
): Promise<ProjectQaContextResult> => {
  const keywords = extractKeywords(query);
  const [activeNode, facts, materials] = await Promise.all([
    activeNodeId ? db.nodes.get(activeNodeId) : Promise.resolve(null),
    db.facts.where('bookId').equals(book.id).toArray(),
    db.materials.where('bookId').equals(book.id).toArray(),
  ]);

  const [ancestors, linearContext, semanticContext, characterStates] = activeNode
    ? await Promise.all([
        getAncestors(activeNode.id),
        getLinearContext(book.id, activeNode.id, 3),
        getSemanticContext(book.id, activeNode.id, `${query}\n${activeNode.title}\n${activeNode.summary}`, 4),
        getSceneCharacterStates(book.id, activeNode.id),
      ])
    : [[], '', '', []];

  const scoredFacts = facts
    .filter((fact) => fact.status === 'active')
    .map((fact) => ({ fact, score: scoreByKeywords(`${fact.statement}\n${fact.notes || ''}\n${fact.tags.join(' ')}`, keywords) + (fact.locked ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || Number(b.fact.locked) - Number(a.fact.locked) || b.fact.updatedAt - a.fact.updatedAt)
    .slice(0, 6)
    .map(({ fact }) => fact);

  const scoredMaterials = materials
    .map((entry) => ({ entry, score: scoreByKeywords(`${entry.title}\n${entry.content}\n${entry.tags.join(' ')}`, keywords) + (entry.linkedNodeId === activeNodeId ? 1 : 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, 4)
    .map(({ entry }) => entry);

  const sources: ProjectQaSource[] = [];
  if (activeNode) {
    sources.push({ label: `当前节点：${activeNode.title}`, nodeId: activeNode.id });
  }
  ancestors.forEach((ancestor) => {
    sources.push({ label: `父级结构：${ancestor.title}`, nodeId: ancestor.id });
  });
  scoredFacts.forEach((fact) => {
    sources.push({ label: `事实：${fact.statement}`, nodeId: fact.sourceNodeId });
  });
  scoredMaterials.forEach((entry) => {
    sources.push({ label: `素材：${entry.title}`, nodeId: entry.linkedNodeId });
  });

  const context = `
[项目问答模式]
你正在回答关于这本书内部资料的问题。请优先基于给定资料回答；如果资料不足，明确说“资料不足，建议补充相关节点/事实”。
回答时尽量先给结论，再给依据。最后单独列出“引用来源”。

[书名]
${book.title}

[核心梗概]
${book.premise}

[世界观]
${book.worldSetting}

[角色档案]
${book.characters.map((character) => `- ${character.name}（${character.role}）：${character.description}｜秘密：${character.secret || '无'}`).join('\n') || '暂无角色'}

[当前节点]
${activeNode ? `${activeNode.title}\n摘要：${activeNode.summary}\n正文：${activeNode.content || '暂无正文'}` : '当前未选中节点'}

[当前节点父级结构]
${ancestors.map((ancestor) => `${ancestor.title}：${ancestor.summary}`).join('\n') || '无'}

[前文上下文]
${linearContext || '无'}

[语义相关场景]
${semanticContext || '无'}

[相关事实]
${scoredFacts.map((fact) => `- ${fact.locked ? '[锁定] ' : ''}${fact.statement}${fact.notes ? `（${fact.notes}）` : ''}`).join('\n') || '无'}

[相关素材]
${scoredMaterials.map((entry) => `- [${entry.type}] ${entry.title}：${entry.content.slice(0, 160)}`).join('\n') || '无'}

[角色状态账本]
${characterStates.map((state) => `- ${state.characterName}：地点=${state.location || '未填'}；身体=${state.physicalState || '未填'}；已知=${state.knowledgeState || '未填'}；持有物=${state.inventory || '未填'}`).join('\n') || '无'}
`.trim();

  return { context, sources };
};
