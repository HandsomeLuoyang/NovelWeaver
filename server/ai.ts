import { GoogleGenAI } from '@google/genai';
import type {
  AIModel,
  Book,
  Character,
  ConsistencyFindingCategory,
  ModelConfig,
  PromptProfile,
  PromptTaskType,
  StoryNode,
} from '../src/types.ts';
import { buildFactPromptContext } from '../src/services/factLibrary.ts';
import { buildMaterialPromptContext } from '../src/services/materialLibrary.ts';
import {
  createDefaultPromptProfile,
  normalizePromptProfiles,
  renderPrompt,
} from '../src/services/promptProfiles.ts';
import { buildOpenAIChatCompletionsUrl, formatOpenAINetworkError } from '../src/services/openaiCompat.ts';
import { evaluatePublishWorkflow } from '../src/services/publishWorkflowService.ts';
import { runConsistencyCheck } from '../src/services/consistencyService.ts';
import { runPacingDiagnostics } from '../src/services/pacingDiagnostics.ts';
import type { ContentSnapshot, SettingsSnapshot } from '../shared/storage.ts';
import {
  findBook,
  findNode,
  getBookCharacterStates,
  getBookFacts,
  getBookMaterials,
  getBookNodes,
  getSettingsSnapshot,
} from './store.ts';

type TaskType = PromptTaskType | 'rewrite' | 'creative_rescue' | 'project_qa' | 'consistency' | 'pacing' | 'publish_pack';

type ProviderRuntimeConfig = {
  provider: 'google' | 'openai';
  apiKey: string;
  baseUrl?: string;
  modelName: string;
  temperature: number;
  enableQualityCheck: boolean;
  enableCreativitySeeds: boolean;
  creativeToolkit: {
    antiBlockMode: boolean;
    divergenceBoost: number;
    twistIntensity: number;
    paceVariance: number;
  };
};

type SettingsStateShape = {
  models?: AIModel[];
  modelConfig?: ModelConfig;
  promptProfiles?: PromptProfile[];
  activePromptProfileId?: string;
};

type TaskContextOverrides = {
  hierarchyContext?: string;
  linearContext?: string;
  semanticContext?: string;
  factSummary?: string;
  factHardConstraints?: string;
  factSoftContext?: string;
  materialSummary?: string;
  materialContext?: string;
  styleBiblePrompt?: string;
};

export interface AITaskExecutionRequest {
  taskType: TaskType;
  input: Record<string, unknown>;
}

export type AITaskExecutionResult =
  | { kind: 'genesis'; title: string; premise: string; worldSetting: string; characters: Character[]; initialVolumes: Array<{ title: string; summary: string }> }
  | { kind: 'expansion'; childType: StoryNode['type']; nodes: Array<{ title: string; summary: string }> }
  | { kind: 'text'; mode: 'draft' | 'polish' | 'chat'; content: string }
  | { kind: 'rewrite'; variants: string[] }
  | { kind: 'creative_rescue'; direction: string; nextBeats: string[]; conflictEscalations: string[]; twists: string[]; dialogueHooks: string[]; sensoryAnchors: string[]; cliffhangers: string[] }
  | { kind: 'project_qa'; answer: string; sources: Array<{ label: string; nodeId?: string }> }
  | { kind: 'consistency'; findings: Array<{ id: string; severity: 'high' | 'medium' | 'low'; category: ConsistencyFindingCategory; title: string; description: string; nodeId?: string }> }
  | { kind: 'pacing'; report: ReturnType<typeof runPacingDiagnostics> }
  | { kind: 'publish_pack'; report: ReturnType<typeof evaluatePublishWorkflow>; markdown: string };

const DEFAULT_CREATIVITY = {
  genesis: 0.9,
  expansion: 0.8,
  drafting: 0.75,
  polishing: 0.6,
};

const clampTemperature = (temperature: number) => Math.max(0, Math.min(1, temperature));

const resolveTaskTemperature = (task: PromptTaskType, profile: typeof DEFAULT_CREATIVITY) => {
  switch (task) {
    case 'genesis': return clampTemperature(profile.genesis);
    case 'expansion': return clampTemperature(profile.expansion);
    case 'drafting': return clampTemperature(profile.drafting);
    case 'polishing': return clampTemperature(profile.polishing);
    case 'chat': return 0.7;
    default: return 0.7;
  }
};

const getPromptControls = (task: PromptTaskType, config: ProviderRuntimeConfig) => {
  const parts: string[] = [];

  if (config.enableCreativitySeeds && task !== 'polishing') {
    const creativitySeed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    parts.push(`[创意种子]\nSeed: ${creativitySeed}\n在不破坏逻辑前提下，允许加入少量新颖但可解释的创意。`);
  }

  if (config.enableQualityCheck) {
    parts.push('[质量闸门]\n输出前请自检，确保：角色动机一致、时间线无冲突、世界观规则不自相矛盾。');
  }

  if (task !== 'genesis') {
    parts.push(`[创意控制参数]\n发散度=${config.creativeToolkit.divergenceBoost.toFixed(2)}; 反转强度=${config.creativeToolkit.twistIntensity.toFixed(2)}; 节奏波动=${config.creativeToolkit.paceVariance.toFixed(2)}。`);
  }

  if (config.creativeToolkit.antiBlockMode && (task === 'drafting' || task === 'expansion' || task === 'chat')) {
    parts.push('[防卡文规则]\n请确保至少包含一个推进动作、一个冲突升级点和一个下一步悬念钩子。');
  }

  return parts.join('\n\n');
};

const buildStyleBiblePrompt = (book?: Book | null) => {
  if (!book) return '';
  const segments: string[] = [];
  if (book.writingStyle) segments.push(`目标文风: ${book.writingStyle}`);
  if (Array.isArray(book.styleReferences) && book.styleReferences.length > 0) {
    segments.push(`参考作品: ${book.styleReferences.join('、')}`);
  }
  if (book.styleBible?.rules?.trim()) segments.push(`风格规则:\n${book.styleBible.rules.trim()}`);
  if (book.styleBible?.bannedTerms?.length) segments.push(`禁用词: ${book.styleBible.bannedTerms.join('、')}`);
  if (book.styleBible?.sentencePatterns?.length) segments.push(`句式偏好: ${book.styleBible.sentencePatterns.join('；')}`);
  return segments.length > 0 ? `[风格圣经]\n${segments.join('\n')}` : '';
};

const getSettingsState = (snapshot?: SettingsSnapshot): SettingsStateShape => {
  const settings = snapshot || getSettingsSnapshot();
  return (settings.state || {}) as SettingsStateShape;
};

const resolveTaskPromptType = (taskType: TaskType): PromptTaskType => {
  switch (taskType) {
    case 'genesis':
    case 'expansion':
    case 'drafting':
    case 'polishing':
    case 'chat':
      return taskType;
    case 'rewrite':
      return 'polishing';
    case 'creative_rescue':
    case 'project_qa':
      return 'chat';
    default:
      return 'chat';
  }
};

const getPromptProfile = (settings: SettingsStateShape, promptProfileId?: string) => {
  const builtin = createDefaultPromptProfile();
  const profiles = normalizePromptProfiles(settings.promptProfiles);
  const targetProfileId = promptProfileId || settings.activePromptProfileId || builtin.id;
  return profiles.find((profile) => profile.id === targetProfileId) || profiles[0] || builtin;
};

const getTaskPrompts = (
  settings: SettingsStateShape,
  task: TaskType,
  variables: Record<string, string | number | undefined>,
  promptProfileId?: string
) => {
  const promptTask = resolveTaskPromptType(task);
  const profile = getPromptProfile(settings, promptProfileId);
  const fallback = createDefaultPromptProfile().templates[promptTask];
  const template = profile.templates?.[promptTask] || fallback;
  return {
    systemPrompt: renderPrompt(template.systemPrompt || fallback.systemPrompt, variables).trim(),
    userPrompt: renderPrompt(template.userPrompt || fallback.userPrompt, variables).trim(),
    promptProfileId: profile.id,
  };
};

const getConfigForTask = (
  settings: SettingsStateShape,
  task: PromptTaskType
): ProviderRuntimeConfig => {
  const models = settings.models || [];
  const config = settings.modelConfig;
  if (!config || models.length === 0) {
    throw new Error('未配置模型，请先通过设置或 /api/storage/models 写入模型配置。');
  }

  const creativityProfile = config.creativityLevel || DEFAULT_CREATIVITY;
  let modelId = '';
  switch (task) {
    case 'genesis': modelId = config.genesisModelId; break;
    case 'expansion': modelId = config.expansionModelId; break;
    case 'drafting': modelId = config.draftingModelId; break;
    case 'polishing': modelId = config.polishingModelId; break;
    case 'chat': modelId = config.chatModelId; break;
  }

  const modelDef = models.find((item) => item.id === modelId) || models[0];
  if (!modelDef) throw new Error('未找到可用模型。');

  const provider = modelDef.baseUrl?.trim() ? 'openai' : modelDef.provider;
  const envApiKey = provider === 'google'
    ? (process.env.VITE_GEMINI_API_KEY || process.env.VITE_API_KEY || '')
    : (process.env.VITE_OPENAI_API_KEY || process.env.VITE_API_KEY || '');
  const apiKey = modelDef.apiKey?.trim() || envApiKey.trim();
  if (!apiKey) throw new Error('模型 API Key 未配置。');

  return {
    provider,
    apiKey,
    baseUrl: modelDef.baseUrl,
    modelName: modelDef.modelName,
    temperature: resolveTaskTemperature(task, creativityProfile),
    enableQualityCheck: Boolean(config.enableQualityCheck),
    enableCreativitySeeds: Boolean(config.enableCreativitySeeds),
    creativeToolkit: {
      antiBlockMode: Boolean(config.creativeToolkit?.antiBlockMode ?? true),
      divergenceBoost: Number(config.creativeToolkit?.divergenceBoost ?? 0.65),
      twistIntensity: Number(config.creativeToolkit?.twistIntensity ?? 0.55),
      paceVariance: Number(config.creativeToolkit?.paceVariance ?? 0.5),
    },
  };
};

const callGoogle = async (
  config: ProviderRuntimeConfig,
  prompt: string,
  systemPrompt: string,
  jsonMode = false
) => {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await ai.models.generateContent({
    model: config.modelName,
    contents: prompt,
    config: {
      temperature: config.temperature,
      responseMimeType: jsonMode ? 'application/json' : undefined,
      systemInstruction: systemPrompt,
    },
  } as never);
  return response.text || '';
};

const callOpenAI = async (
  config: ProviderRuntimeConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
) => {
  const url = buildOpenAIChatCompletionsUrl(config.baseUrl);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.modelName,
        messages,
        temperature: config.temperature,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API Error ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '');
  } catch (error) {
    throw formatOpenAINetworkError(error, url);
  }
};

const cleanJson = (raw: string) => raw.replace(/```json\n|\n```/g, '').replace(/```/g, '').trim();

const parseJson = <T>(raw: string): T => JSON.parse(cleanJson(raw)) as T;

const getAncestors = (nodes: StoryNode[], nodeId: string) => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const ancestors: StoryNode[] = [];
  let current = nodeMap.get(nodeId);
  let parentId = current?.parentId;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) break;
    ancestors.unshift(parent);
    parentId = parent.parentId;
  }
  return ancestors;
};

const getLinearContext = (nodes: StoryNode[], currentNodeId: string, limit = 3) => {
  const byParent = new Map<string | null, StoryNode[]>();
  nodes.forEach((node) => {
    const bucket = byParent.get(node.parentId) || [];
    bucket.push(node);
    byParent.set(node.parentId, bucket);
  });
  byParent.forEach((bucket) => bucket.sort((a, b) => a.order - b.order));

  const flatten = (parentId: string | null): StoryNode[] => {
    const children = byParent.get(parentId) || [];
    return children.flatMap((child) => (child.type === 'scene' ? [child] : flatten(child.id)));
  };
  const scenes = flatten(null);
  const currentIndex = scenes.findIndex((node) => node.id === currentNodeId);
  if (currentIndex <= 0) return '';
  return scenes
    .slice(Math.max(0, currentIndex - limit), currentIndex)
    .map((node) => `[前文场景: ${node.title}]\n${node.content || '(暂无内容)'}`)
    .join('\n\n');
};

const extractKeywords = (text: string) => {
  const lowered = text.toLowerCase();
  const matches = lowered.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{3,}/g) || [];
  return Array.from(new Set(matches)).slice(0, 40);
};

const toTermFrequency = (tokens: string[]) => {
  const tf = new Map<string, number>();
  tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
  return tf;
};

const buildIdf = (documents: string[][]) => {
  const docCount = documents.length;
  const df = new Map<string, number>();
  documents.forEach((doc) => {
    const seen = new Set(doc);
    seen.forEach((token) => {
      df.set(token, (df.get(token) || 0) + 1);
    });
  });
  const idf = new Map<string, number>();
  df.forEach((count, token) => {
    idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  });
  return idf;
};

const applyIdf = (tf: Map<string, number>, idf: Map<string, number>) => {
  const weighted = new Map<string, number>();
  tf.forEach((value, token) => weighted.set(token, value * (idf.get(token) || 1)));
  return weighted;
};

const cosineSimilarity = (a: Map<string, number>, b: Map<string, number>) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, key) => {
    normA += value * value;
    dot += value * (b.get(key) || 0);
  });
  b.forEach((value) => {
    normB += value * value;
  });
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const getSemanticContext = (nodes: StoryNode[], currentNodeId: string, query: string, limit = 3) => {
  const queryTokens = extractKeywords(query);
  if (queryTokens.length === 0) return '';
  const candidateScenes = nodes.filter((node) => node.type === 'scene' && node.id !== currentNodeId && Boolean(node.content?.trim()));
  const docs = candidateScenes.map((scene) => extractKeywords(`${scene.title}\n${scene.summary}\n${scene.content || ''}`));
  docs.push(queryTokens);
  const idf = buildIdf(docs);
  const queryVector = applyIdf(toTermFrequency(queryTokens), idf);
  const scored = candidateScenes
    .map((scene, index) => ({
      scene,
      score: cosineSimilarity(queryVector, applyIdf(toTermFrequency(docs[index]), idf)),
    }))
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored
    .map((entry) => `[相关场景: ${entry.scene.title} | 相关度:${entry.score.toFixed(2)}]\n${entry.scene.content || ''}`)
    .join('\n\n');
};

const getSceneCharacterStates = (snapshot: ContentSnapshot, bookId: string, nodeId: string) => getBookCharacterStates(snapshot, bookId)
  .filter((entry) => entry.nodeId === nodeId);

const getNodeTypeName = (type: StoryNode['type']) => {
  switch (type) {
    case 'volume': return '卷';
    case 'arc': return '剧情';
    case 'chapter': return '章';
    case 'scene': return '场景';
  }
};

const getChildType = (type: StoryNode['type']): StoryNode['type'] | null => {
  switch (type) {
    case 'volume': return 'arc';
    case 'arc': return 'chapter';
    case 'chapter': return 'scene';
    default: return null;
  }
};

const runModel = async (
  config: ProviderRuntimeConfig,
  prompt: string,
  systemPrompt: string,
  jsonMode = false
) => {
  if (config.provider === 'google') {
    return callGoogle(config, prompt, systemPrompt, jsonMode);
  }
  return callOpenAI(config, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ]);
};

const buildProjectQaContext = (
  snapshot: ContentSnapshot,
  book: Book,
  query: string,
  activeNodeId: string | null
) => {
  const keywords = extractKeywords(query).slice(0, 12);
  const activeNode = activeNodeId ? findNode(snapshot, activeNodeId) : null;
  const facts = getBookFacts(snapshot, book.id);
  const materials = getBookMaterials(snapshot, book.id);
  const bookNodes = getBookNodes(snapshot, book.id);
  const ancestors = activeNode ? getAncestors(bookNodes, activeNode.id) : [];
  const linearContext = activeNode ? getLinearContext(bookNodes, activeNode.id, 3) : '';
  const semanticContext = activeNode ? getSemanticContext(bookNodes, activeNode.id, `${query}\n${activeNode.title}\n${activeNode.summary}`, 4) : '';
  const characterStates = activeNode ? getSceneCharacterStates(snapshot, book.id, activeNode.id) : [];

  const scoreByKeywords = (text: string) => keywords.reduce((score, keyword) => (
    text.toLowerCase().includes(keyword) ? score + 1 : score
  ), 0);

  const scoredFacts = facts
    .filter((fact) => fact.status === 'active')
    .map((fact) => ({
      fact,
      score: scoreByKeywords(`${fact.statement}\n${fact.notes || ''}\n${fact.tags.join(' ')}`) + (fact.locked ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || Number(b.fact.locked) - Number(a.fact.locked) || b.fact.updatedAt - a.fact.updatedAt)
    .slice(0, 6)
    .map((item) => item.fact);

  const scoredMaterials = materials
    .map((entry) => ({
      entry,
      score: scoreByKeywords(`${entry.title}\n${entry.content}\n${entry.tags.join(' ')}`) + (entry.linkedNodeId === activeNodeId ? 1 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    .slice(0, 4)
    .map((item) => item.entry);

  const sources: Array<{ label: string; nodeId?: string }> = [];
  if (activeNode) sources.push({ label: `当前节点：${activeNode.title}`, nodeId: activeNode.id });
  ancestors.forEach((ancestor) => sources.push({ label: `父级结构：${ancestor.title}`, nodeId: ancestor.id }));
  scoredFacts.forEach((fact) => sources.push({ label: `事实：${fact.statement}`, nodeId: fact.sourceNodeId }));
  scoredMaterials.forEach((entry) => sources.push({ label: `素材：${entry.title}`, nodeId: entry.linkedNodeId }));

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

const parseInputString = (input: Record<string, unknown>, key: string) => String(input[key] || '').trim();

export const executeAITask = async (
  contentSnapshot: ContentSnapshot,
  settingsSnapshot: SettingsSnapshot | undefined,
  request: AITaskExecutionRequest
): Promise<AITaskExecutionResult> => {
  const settings = getSettingsState(settingsSnapshot);

  if (request.taskType === 'consistency') {
    const bookId = parseInputString(request.input, 'bookId');
    const book = findBook(contentSnapshot, bookId);
    if (!book) throw new Error('书籍不存在');
    return {
      kind: 'consistency',
      findings: runConsistencyCheck(
        book,
        getBookNodes(contentSnapshot, bookId),
        getBookFacts(contentSnapshot, bookId),
        getBookCharacterStates(contentSnapshot, bookId)
      ),
    };
  }

  if (request.taskType === 'pacing') {
    const bookId = parseInputString(request.input, 'bookId');
    return {
      kind: 'pacing',
      report: runPacingDiagnostics(getBookNodes(contentSnapshot, bookId)),
    };
  }

  if (request.taskType === 'publish_pack') {
    const bookId = parseInputString(request.input, 'bookId');
    const book = findBook(contentSnapshot, bookId);
    if (!book) throw new Error('书籍不存在');
    const report = evaluatePublishWorkflow(
      book,
      getBookNodes(contentSnapshot, bookId),
      getBookFacts(contentSnapshot, bookId),
      contentSnapshot.foreshadows.filter((entry) => entry.bookId === bookId)
    );
    const markdown = [
      `# ${book.title} 发布包`,
      '',
      `- 质量分：${report.qualityScore}`,
      `- 草稿覆盖率：${Math.round(report.draftCoverage * 100)}%`,
      `- 大纲完整度：${Math.round(report.outlineCompleteness * 100)}%`,
      `- 元数据覆盖率：${Math.round(report.metadataCoverage * 100)}%`,
      `- 未回收伏笔：${report.unresolvedForeshadows}`,
      '',
      '## 阶段门禁',
      ...report.stages.map((stage) => `### ${stage.title}\n- 状态：${stage.passed ? '通过' : '未通过'}\n- 说明：${stage.description}\n${stage.blockers.map((blocker) => `- ${blocker.message}`).join('\n') || '- 无阻塞项'}`),
    ].join('\n');
    return { kind: 'publish_pack', report, markdown };
  }

  const promptTaskType = resolveTaskPromptType(request.taskType);
  const config = getConfigForTask(settings, promptTaskType);

  if (request.taskType === 'genesis') {
    const userPrompt = parseInputString(request.input, 'userPrompt');
    const controls = getPromptControls('genesis', config);
    const prompts = getTaskPrompts(settings, 'genesis', { controls, userPrompt }, parseInputString(request.input, 'promptProfileId') || undefined);
    const systemPrompt = `${prompts.systemPrompt}\n请务必返回合法 JSON：{"title":"","premise":"","worldSetting":"","characters":[{"name":"","role":"","description":"","secret":""}],"initialVolumes":[{"title":"","summary":""}]}`;
    const raw = await runModel(config, prompts.userPrompt, systemPrompt, true);
    return {
      kind: 'genesis',
      ...parseJson<AITaskExecutionResult & { kind: 'genesis' }>(raw),
    };
  }

  if (request.taskType === 'project_qa') {
    const bookId = parseInputString(request.input, 'bookId');
    const query = parseInputString(request.input, 'query');
    const activeNodeId = parseInputString(request.input, 'activeNodeId') || null;
    const book = findBook(contentSnapshot, bookId);
    if (!book) throw new Error('书籍不存在');
    const { context, sources } = buildProjectQaContext(contentSnapshot, book, query, activeNodeId);
    const controls = getPromptControls('chat', config);
    const prompts = getTaskPrompts(settings, 'project_qa', {
      controls,
      chatContext: context,
      dialogue: `用户: ${query}`,
      factHardConstraints: '以上上下文已包含事实约束',
      factSoftContext: '',
      materialSummary: '',
      materialContext: '',
    }, parseInputString(request.input, 'promptProfileId') || undefined);
    const answer = await runModel(config, prompts.userPrompt, prompts.systemPrompt, false);
    return { kind: 'project_qa', answer, sources };
  }

  if (request.taskType === 'creative_rescue') {
    const bookId = parseInputString(request.input, 'bookId');
    const nodeId = parseInputString(request.input, 'nodeId');
    const problem = parseInputString(request.input, 'problem') || '当前剧情推进乏力，请提出推进方案';
    const book = findBook(contentSnapshot, bookId);
    const node = findNode(contentSnapshot, nodeId);
    if (!book || !node) throw new Error('书籍或节点不存在');
    const bookNodes = getBookNodes(contentSnapshot, bookId);
    const ancestors = getAncestors(bookNodes, node.id);
    const prompt = `
[书名]
${book.title}

[世界观]
${book.worldSetting}

[角色]
${book.characters.map((entry) => `${entry.name}:${entry.role}`).join('；')}

[结构]
${ancestors.map((ancestor) => `${getNodeTypeName(ancestor.type)}:${ancestor.title} - ${ancestor.summary}`).join('\n')}

[当前节点]
${node.title}
${node.summary}
${node.content || ''}

[问题]
${problem}

[任务]
请返回 JSON：
{
  "direction": "",
  "nextBeats": ["", ""],
  "conflictEscalations": ["", ""],
  "twists": ["", ""],
  "dialogueHooks": ["", ""],
  "sensoryAnchors": ["", ""],
  "cliffhangers": ["", ""]
}
`;
    const raw = await runModel(config, prompt, '你是擅长打通剧情卡点的小说策划，请只返回合法 JSON。', true);
    return {
      kind: 'creative_rescue',
      ...parseJson<AITaskExecutionResult & { kind: 'creative_rescue' }>(raw),
    };
  }

  if (request.taskType === 'rewrite') {
    const bookId = parseInputString(request.input, 'bookId');
    const selection = parseInputString(request.input, 'selection');
    const preContext = parseInputString(request.input, 'preContext');
    const postContext = parseInputString(request.input, 'postContext');
    const variantCount = Math.min(5, Math.max(2, Number(request.input.variantCount || 3)));
    const book = findBook(contentSnapshot, bookId);
    if (!book) throw new Error('书籍不存在');
    const factContext = buildFactPromptContext(getBookFacts(contentSnapshot, bookId));
    const materialContext = buildMaterialPromptContext(getBookMaterials(contentSnapshot, bookId), `${selection}\n${preContext.slice(-280)}\n${postContext.slice(0, 280)}`);
    const prompts = getTaskPrompts(settings, 'rewrite', {
      controls: getPromptControls('polishing', config),
      bookTitle: book.title,
      worldSettingSnippet: `${book.worldSetting.slice(0, 200)}...`,
      contextSnippet: `${preContext.slice(-320)}\n<<待改写文本>>\n${postContext.slice(0, 320)}`,
      selection,
      polishRangeHint: '仅改写选中的文本片段，不改写上下文',
      factSummary: factContext.factSummary,
      factHardConstraints: factContext.factHardConstraints,
      factSoftContext: factContext.factSoftContext,
      materialSummary: materialContext.materialSummary,
      materialContext: materialContext.materialContext,
    }, parseInputString(request.input, 'promptProfileId') || undefined);
    const systemPrompt = `${prompts.systemPrompt}\n请只返回 JSON：{"variants":["版本1","版本2","版本3"]}`;
    const userPrompt = `${prompts.userPrompt}\n\n请给出 ${variantCount} 个可直接替换的改写版本，仅改写“选中文本”，不要复述上下文。`;
    const raw = await runModel(config, userPrompt, systemPrompt, true);
    const parsed = parseJson<{ variants?: string[] }>(raw);
    return {
      kind: 'rewrite',
      variants: Array.isArray(parsed.variants) ? parsed.variants.map((item) => String(item || '').trim()).filter(Boolean).slice(0, variantCount) : [],
    };
  }

  if (request.taskType === 'chat') {
    const bookId = parseInputString(request.input, 'bookId');
    const history = Array.isArray(request.input.history) ? request.input.history as Array<{ role: 'user' | 'assistant' | 'system'; content: string }> : [];
    const context = parseInputString(request.input, 'context');
    const book = bookId ? findBook(contentSnapshot, bookId) : null;
    const factContext = buildFactPromptContext(book ? getBookFacts(contentSnapshot, book.id) : []);
    const materialContext = buildMaterialPromptContext(book ? getBookMaterials(contentSnapshot, book.id) : [], `${context}\n${history.map((entry) => entry.content).join('\n').slice(-600)}`);
    const dialogue = history.map((entry) => `${entry.role === 'assistant' ? '助手' : entry.role === 'system' ? '系统' : '用户'}: ${entry.content}`).join('\n\n');
    const prompts = getTaskPrompts(settings, 'chat', {
      controls: getPromptControls('chat', config),
      chatContext: context,
      dialogue,
      factSummary: factContext.factSummary,
      factHardConstraints: factContext.factHardConstraints,
      factSoftContext: factContext.factSoftContext,
      materialSummary: materialContext.materialSummary,
      materialContext: materialContext.materialContext,
    }, parseInputString(request.input, 'promptProfileId') || undefined);
    const styleBiblePrompt = buildStyleBiblePrompt(book);
    const content = await runModel(
      config,
      prompts.userPrompt,
      `${prompts.systemPrompt}\n\n[事实库硬约束]\n${factContext.factHardConstraints}${styleBiblePrompt ? `\n\n${styleBiblePrompt}` : ''}\n\n[素材库参考]\n${materialContext.materialContext}`,
      false
    );
    return { kind: 'text', mode: 'chat', content };
  }

  const bookId = parseInputString(request.input, 'bookId');
  const nodeId = parseInputString(request.input, 'nodeId');
  const book = findBook(contentSnapshot, bookId);
  const node = findNode(contentSnapshot, nodeId);
  if (!book || !node) {
    throw new Error('书籍或节点不存在');
  }

  const bookNodes = getBookNodes(contentSnapshot, bookId);
  const ancestors = getAncestors(bookNodes, node.id);
  const linearContext = getLinearContext(bookNodes, node.id, Math.min(10, Math.max(1, Number(request.input.contextLimit || 5))));
  const semanticContext = getSemanticContext(bookNodes, node.id, `${node.title}\n${node.summary}\n${parseInputString(request.input, 'selection')}`, 4);
  const factContext = buildFactPromptContext(getBookFacts(contentSnapshot, bookId));
  const materialContext = buildMaterialPromptContext(getBookMaterials(contentSnapshot, bookId), `${node.title}\n${node.summary}\n${linearContext.slice(-500)}`);
  const contextOverrides = (request.input.contextOverrides || {}) as TaskContextOverrides;

  if (request.taskType === 'expansion') {
    const childType = String(request.input.childType || getChildType(node.type)) as StoryNode['type'];
    const prompts = getTaskPrompts(settings, 'expansion', {
      controls: getPromptControls('expansion', config),
      bookTitle: book.title,
      bookPremise: book.premise,
      charactersSummary: book.characters.map((entry) => `${entry.name}: ${entry.role}`).join(', '),
      parentTypeName: getNodeTypeName(node.type),
      parentTitle: node.title,
      parentSummary: node.summary,
      childTypeName: getNodeTypeName(childType),
      factSummary: contextOverrides.factSummary ?? factContext.factSummary,
      factHardConstraints: contextOverrides.factHardConstraints ?? factContext.factHardConstraints,
      factSoftContext: contextOverrides.factSoftContext ?? factContext.factSoftContext,
      materialSummary: contextOverrides.materialSummary ?? materialContext.materialSummary,
      materialContext: contextOverrides.materialContext ?? materialContext.materialContext,
    }, parseInputString(request.input, 'promptProfileId') || undefined);
    const raw = await runModel(
      config,
      prompts.userPrompt,
      `${prompts.systemPrompt}\n\n[事实库硬约束]\n${contextOverrides.factHardConstraints ?? factContext.factHardConstraints}\n\n[素材库参考]\n${contextOverrides.materialContext ?? materialContext.materialContext}\n\n请返回 JSON：{"nodes":[{"title":"","summary":""}]}`,
      true
    );
    const parsed = parseJson<{ nodes?: Array<{ title: string; summary: string }> }>(raw);
    return {
      kind: 'expansion',
      childType,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    };
  }

  if (request.taskType === 'drafting') {
    const prompts = getTaskPrompts(settings, 'drafting', {
      controls: getPromptControls('drafting', config),
      bookTitle: book.title,
      bookPremise: book.premise,
      worldSetting: book.worldSetting,
      charactersJson: JSON.stringify(book.characters.map((entry) => ({ name: entry.name, role: entry.role, description: entry.description }))),
      hierarchyContext: contextOverrides.hierarchyContext ?? (ancestors.length > 0 ? ancestors.map((entry) => `[${getNodeTypeName(entry.type)}: ${entry.title}]\n梗概: ${entry.summary}`).join('\n\n') : '无上级结构信息'),
      linearContext: contextOverrides.linearContext ?? (linearContext || '（这是故事的开篇）'),
      semanticContext: contextOverrides.semanticContext ?? (semanticContext || '（未命中高相关历史片段）'),
      nodeTitle: node.title,
      nodeSummary: node.summary,
      draftLengthHint: parseInputString(request.input, 'draftLengthHint') || '中篇幅（约 1000-2000 字）',
      creativeModeHint: parseInputString(request.input, 'creativeModeHint') || '平衡推进（剧情与文风并重）',
      antiBlockHint: parseInputString(request.input, 'antiBlockHint') || '若出现卡文风险，请优先推进行动线并抛出新问题',
      factSummary: contextOverrides.factSummary ?? factContext.factSummary,
      factHardConstraints: contextOverrides.factHardConstraints ?? factContext.factHardConstraints,
      factSoftContext: contextOverrides.factSoftContext ?? factContext.factSoftContext,
      materialSummary: contextOverrides.materialSummary ?? materialContext.materialSummary,
      materialContext: contextOverrides.materialContext ?? materialContext.materialContext,
    }, parseInputString(request.input, 'promptProfileId') || undefined);
    const content = await runModel(
      config,
      prompts.userPrompt,
      `${prompts.systemPrompt}\n\n[事实库硬约束]\n${contextOverrides.factHardConstraints ?? factContext.factHardConstraints}${buildStyleBiblePrompt(book) ? `\n\n${buildStyleBiblePrompt(book)}` : ''}\n\n[素材库参考]\n${contextOverrides.materialContext ?? materialContext.materialContext}`,
      false
    );
    return { kind: 'text', mode: 'draft', content };
  }

  if (request.taskType === 'polishing') {
    const selection = parseInputString(request.input, 'selection') || (node.content || '');
    const prompts = getTaskPrompts(settings, 'polishing', {
      controls: getPromptControls('polishing', config),
      bookTitle: book.title,
      worldSettingSnippet: `${book.worldSetting.slice(0, 200)}...`,
      contextSnippet: `${node.summary}\n${(node.content || '').slice(-500)}`,
      selection,
      polishRangeHint: parseInputString(request.input, 'polishRange') === 'selection' ? '仅润色选中的文本片段' : '润色整段场景文本',
      factSummary: contextOverrides.factSummary ?? factContext.factSummary,
      factHardConstraints: contextOverrides.factHardConstraints ?? factContext.factHardConstraints,
      factSoftContext: contextOverrides.factSoftContext ?? factContext.factSoftContext,
      materialSummary: contextOverrides.materialSummary ?? materialContext.materialSummary,
      materialContext: contextOverrides.materialContext ?? materialContext.materialContext,
    }, parseInputString(request.input, 'promptProfileId') || undefined);
    const content = await runModel(
      config,
      prompts.userPrompt,
      `${prompts.systemPrompt}\n\n[事实库硬约束]\n${contextOverrides.factHardConstraints ?? factContext.factHardConstraints}${buildStyleBiblePrompt(book) ? `\n\n${buildStyleBiblePrompt(book)}` : ''}\n\n[素材库参考]\n${contextOverrides.materialContext ?? materialContext.materialContext}`,
      false
    );
    return { kind: 'text', mode: 'polish', content };
  }

  throw new Error(`Unsupported AI task: ${request.taskType}`);
};
