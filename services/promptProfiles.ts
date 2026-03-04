import { PromptProfile, PromptTaskType } from '../types';

export const PROMPT_TASKS: PromptTaskType[] = ['genesis', 'expansion', 'drafting', 'polishing', 'chat'];

export const PROMPT_TASK_LABEL: Record<PromptTaskType, string> = {
  genesis: '创世',
  expansion: '扩写',
  drafting: '草稿',
  polishing: '润色',
  chat: '对话',
};

export const PROMPT_REQUIRED_VARIABLES: Record<PromptTaskType, string[]> = {
  genesis: ['userPrompt'],
  expansion: ['bookTitle', 'parentTitle', 'childTypeName'],
  drafting: ['bookTitle', 'hierarchyContext', 'nodeTitle', 'nodeSummary'],
  polishing: ['bookTitle', 'selection'],
  chat: ['chatContext', 'dialogue'],
};

const DEFAULT_TEMPLATES: PromptProfile['templates'] = {
  genesis: {
    systemPrompt: `你是"织梦机"创世引擎。你将灵感种子培育成参天大树。请全程使用中文回答。`,
    userPrompt: `你是一位世界级的通俗小说家和金牌编辑。

{{controls}}

用户灵感: "{{userPrompt}}"

任务:
1. 起一个吸引人的中文书名。
2. 将灵感扩写为 300 字的核心梗概（类似封底简介）。
3. 定义世界观设定/规则（200 字）。
4. 创造 5 个有深度且有秘密的主要角色。
5. 规划故事的第一层级（卷/部）。通常为 3-5 卷。

请确保所有输出均为简体中文。`,
  },
  expansion: {
    systemPrompt: `你是网文界的大神级作家，擅长构建严密的剧情结构。`,
    userPrompt: `[全局上下文]
书名: {{bookTitle}}
核心梗概: {{bookPremise}}
主要角色: {{charactersSummary}}

{{controls}}

[当前焦点]
当前层级: {{parentTypeName}}
当前标题: {{parentTitle}}
当前剧情梗概: {{parentSummary}}

[任务]
请将上述 "{{parentTitle}}" 拆解扩写为 5-10 个 "{{childTypeName}}" (子节点)。

要求：
1. 这一系列的子节点必须能够完整讲述父节点概括的故事。
2. 节奏要紧凑，富有冲突。
3. 子节点的摘要(summary)应作为下一层级写作的具体指令，越具体越好。
4. 请严格使用简体中文。`,
  },
  drafting: {
    systemPrompt: `你是白金级畅销小说家。`,
    userPrompt: `{{controls}}

=== 1. 宏观世界 (World Bible) ===
书名: {{bookTitle}}
核心梗概: {{bookPremise}}
世界观设定: {{worldSetting}}
主要角色表: {{charactersJson}}

=== 2. 剧情脉络 (Structural Context) ===
{{hierarchyContext}}

=== 3. 近期记忆 (Linear Memory) ===
{{linearContext}}

=== 4. 检索记忆 (Semantic Recall) ===
{{semanticContext}}

=== 5. 当前任务 (Writing Instruction) ===
当前场景标题: {{nodeTitle}}
当前场景细纲: {{nodeSummary}}

=== 写作要求 ===
0. 字数目标：{{draftLengthHint}}
1. 一致性：严格遵守世界观和角色设定，不要吃书。
2. 连贯性：紧密承接近期记忆的剧情和文风。
3. 画面感：使用 Show, don't tell 技法，多描写感官细节。
4. 节奏：这一段落应有起伏，字数控制在 1000-2000 字。
5. 格式：使用 Markdown 格式。
6. 语言：简体中文。`,
  },
  polishing: {
    systemPrompt: `你是专业的文学编辑和润色专家。`,
    userPrompt: `{{controls}}

[背景信息]
书名: {{bookTitle}}
世界观风格: {{worldSettingSnippet}}

[上下文片段]
{{contextSnippet}}

[待润色文本]
"{{selection}}"

[任务]
润色范围: {{polishRangeHint}}
请重写并润色上述待润色文本。
要求：
1. 提升文采，使其更有画面感和感染力。
2. 修复语病，优化句子节奏。
3. 保持原意不变，润色后长度控制在原文的 0.7x - 1.8x。
4. 严禁输出上下文片段，严禁输出整段场景。
5. 仅输出如下格式（不要附加解释）：
<POLISHED>
这里是润色后的“待润色文本”
</POLISHED>`,
  },
  chat: {
    systemPrompt: `你是一个专业的写作助手。请根据提供的世界观和当前上下文回答用户的问题。

{{controls}}

[当前上下文]
{{chatContext}}

请用简洁、有帮助的语气回答。如果用户让你写一段内容，请保持与当前文风一致。`,
    userPrompt: `[对话历史]
{{dialogue}}

[任务]
请基于以上上下文，继续回答最后一个用户问题。回答需简洁、可执行。`,
  },
};

const now = () => Date.now();

export const extractTemplateVariables = (template: string) => {
  const matches = template.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
  return Array.from(new Set(matches.map((token) => token.replace(/\{\{|\}\}/g, '').trim())));
};

export const validatePromptTemplate = (
  task: PromptTaskType,
  template: { systemPrompt: string; userPrompt: string }
) => {
  const used = new Set([
    ...extractTemplateVariables(template.systemPrompt),
    ...extractTemplateVariables(template.userPrompt),
  ]);
  const required = PROMPT_REQUIRED_VARIABLES[task] || [];
  return required.filter((variableName) => !used.has(variableName));
};

const cloneTemplates = (templates: PromptProfile['templates']): PromptProfile['templates'] => {
  return PROMPT_TASKS.reduce((acc, task) => {
    acc[task] = {
      systemPrompt: templates[task].systemPrompt,
      userPrompt: templates[task].userPrompt,
    };
    return acc;
  }, {} as PromptProfile['templates']);
};

const getDefaultTemplates = () => cloneTemplates(DEFAULT_TEMPLATES);

export const createDefaultPromptProfile = (): PromptProfile => ({
  id: 'prompt-default',
  name: '默认提示词',
  createdAt: now(),
  updatedAt: now(),
  isBuiltin: true,
  templates: getDefaultTemplates(),
});

export const normalizePromptProfile = (profile: PromptProfile): PromptProfile => {
  const templates = getDefaultTemplates();
  for (const task of PROMPT_TASKS) {
    const current = profile.templates?.[task];
    templates[task] = {
      systemPrompt: (current?.systemPrompt || templates[task].systemPrompt).trim(),
      userPrompt: (current?.userPrompt || templates[task].userPrompt).trim(),
    };
  }

  return {
    ...profile,
    name: (profile.name || '未命名提示词').trim() || '未命名提示词',
    templates,
  };
};

export const normalizePromptProfiles = (profiles: PromptProfile[] | undefined): PromptProfile[] => {
  if (!profiles || profiles.length === 0) return [createDefaultPromptProfile()];
  const normalized = profiles.map(normalizePromptProfile);

  const hasBuiltin = normalized.some((profile) => profile.id === 'prompt-default');
  if (!hasBuiltin) {
    normalized.unshift(createDefaultPromptProfile());
  }
  return normalized;
};

export const renderPrompt = (template: string, variables: Record<string, string | number | undefined>) => {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  });
};

export const clonePromptProfile = (source: PromptProfile, name?: string): PromptProfile => {
  const cloned = normalizePromptProfile(source);
  const timestamp = now();
  return {
    ...cloned,
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${timestamp}-${Math.random()}`,
    name: name || `${cloned.name}（副本）`,
    createdAt: timestamp,
    updatedAt: timestamp,
    isBuiltin: false,
  };
};
