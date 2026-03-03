# 织梦机-AI (NovelWeaver-AI) 项目文档

## 1. 项目简介
**织梦机-AI** 是一个基于 AI 的长篇小说辅助写作工具。它采用“分形递归”的理念，帮助作者从一个简单的灵感逐步扩写成百万字的长篇小说。

### 核心理念
- **创世 (Genesis)**: 从一句话灵感生成完整的世界观、角色表和第一层级的大纲 (卷)。
- **分形扩写 (Fractal Expansion)**: 递归地将上层节点（如“卷”）拆解为下层节点（如“大剧情” -> “章” -> “场景”）。
- **上下文感知 (Context Awareness)**: AI 在写作时不仅知道当前的细纲，还能感知“宏观世界” (世界观)、“剧情脉络” (上级结构) 和 “近期记忆” (前文场景)。

## 2. 技术栈
- **前端框架**: React 19 + Vite (TypeScript)
- **样式**: TailwindCSS + Framer Motion (动画)
- **状态管理**: Zustand (带持久化中间件)
- **本地数据库**: Dexie.js (IndexedDB 封装) - 用于存储书籍和节点数据
- **AI 模型**: Google Gemini API (`@google/genai` SDK)
- **图标**: Lucide React
- **Markdown 渲染**: React-Markdown

## 3. 项目结构

### 根目录
- `App.tsx`: 应用的主入口，负责布局和根据 `currentBook` 状态切换 `Library` (书架) 或 `Workspace` (编辑器)。
- `db.ts`: 数据库定义 (Dexie)。定义了 `books` 和 `nodes` 表，以及递归删除、获取线性上下文等 Helper 函数。
- `store.ts`: 全局状态管理 (Zustand)。管理 `currentBook`, `activeNodeId`, `models` 配置等。
- `types.ts`: TypeScript 类型定义。核心类型包括 `Book`, `StoryNode`, `Character`, `AIModel`。
- `vite.config.ts`: Vite 配置，包含环境变量 (API Key) 的处理。

### components/ (组件)
- `Library.tsx`: 书架界面。用于创建新书 (调用 Genesis) 或打开已有书籍。
- `Outliner.tsx`: 左侧大纲栏。递归树组件，负责展示故事结构，并处理节点的 **AI 扩写** 操作。
- `Editor.tsx`: 右侧编辑器。负责该节点的正文撰写 (AI Drafting)、润色 (AI Polishing) 和预览。
- `BookSettingsModal.tsx`: 书籍设定编辑器 (世界观、角色等)。
- `ModelSettingsModal.tsx`:模型配置界面 (自定义 API Key 和 Model Name)。

### services/ (服务)
- `geminiService.ts`: **核心 AI 逻辑层**。
  - `genesis()`: 创世。
  - `expandNode()`: 节点扩写 (分形生成)。
  - `draftScene()`: 场景起草 (利用全量上下文)。
  - `polishText()`: 文本润色。
  - `getClientForTask()`: 根据任务类型获取对应的 Gemini 模型配置。

## 4. 数据模型

### Book (书籍)
- `title`, `premise` (核心梗概), `worldSetting` (世界观), `characters` (角色表)。

### StoryNode (故事节点)
- `type`: `volume` (卷) -> `arc` (剧情) -> `chapter` (章) -> `scene` (场景)。
- `parentId`: 指向上级节点。`null` 为顶级节点。
- `summary`: 该节点的剧情梗概 (AI 扩写生成，或人工修改)。
- `content`: 仅 `scene` 类型的节点拥有正文内容。

## 5. AI 工作流详情

1.  **创世 (Genesis)**
    - 输入: 用户的一句话灵感。
    - 输出: 书名、300字梗概、世界观、5个角色、初始的 3-5 卷大纲。

2.  **扩写 (Expansion)**
    - 输入: 父节点 (Title, Summary) + 全局上下文 (Book info)。
    - prompt: "将 [父节点] 拆解为 5-10 个 [子类型]..."
    - 输出: 子节点列表 (Title, Summary)。

3.  **起草 (Drafting)**
    - 仅针对 `scene` 节点。
    - 输入:
        - **宏观世界**: 书名、世界观、角色。
        - **剧情脉络**: 祖先节点的 Summary 链 (卷概 -> 剧情概 -> 章概)。
        - **近期记忆**: 线性顺序上前 3-5 个场景的正文内容 (用于保持连贯性)。
        - **当前指令**: 当前场景的 Summary。
    - 输出: 正文流 (Stream)。

4.  **润色 (Polishing)**
    - 针对选中的文本进行优美化改写。

## 6. 开发注意事项
- **数据库 Schema**: 如果修改 `types.ts` 中的结构，可能需要更新 `db.ts` 中的 `version` 以触发 IndexedDB 迁移。
- **Environment**: 默认使用 `.env.local` 中的 `VITE_GEMINI_API_KEY` / `VITE_OPENAI_API_KEY`，但用户可以在 UI 中配置自定义 Key（本地优先持久化）。
- **Prompt 维护**: 所有 Prompt 均在 `geminiService.ts` 中，修改 Prompt 需注意 JSON 格式的输出要求 (Genesis/Expansion 需要 JSON Schema)。
