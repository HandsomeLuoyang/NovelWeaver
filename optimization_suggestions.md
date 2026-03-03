# 织梦机-AI 项目优化建议

基于对当前项目代码的深度分析，提出以下优化建议，主要关注代码健壮性、用户体验和 AI 交互的可靠性。

## 1. 架构与代码质量

### 1.1 抽离 AI 逻辑为 Custom Hooks
- **现状**: `Editor.tsx` 和 `Outliner.tsx` 中直接耦合了 AI 调用逻辑 (`handleExpandAI`, `handleAIDraft`)。
- **建议**: 创建 `useStoryGeneration` 或 `useAIWriter` hooks。
- **好处**: 
    - 逻辑复用：方便在不同组件（如批量操作、右键菜单）中调用 AI。
    - 状态管理：统一管理 `isGenerating`、错误处理和 Loading 状态。

### 1.2 增强类型安全性
- **现状**: `geminiService.ts` 中使用了 `JSON.parse` 处理 AI 返回，未进行严格的 Schema 校验。
- **建议**: 使用 `zod` 库定义 `GenesisResponse` 和 `ExpansionResponse` 的 Schema，并在解析后进行校验 (Data Validation)。
- **好处**: 防止 AI 返回结构微调导致的 Crash，提供更友好的错误提示。

### 1.3 数据库访问优化
- **现状**: `Outliner` 组件在 `currentBook` 变化时全量拉取根节点；`Editor` 保存使用简单的 `setInterval`。
- **建议**: 
    - 使用 `dexie-react-hooks` (`useLiveQuery`) 替代 `useEffect` 手动查询，让 UI 自动响应数据库变化。
    - 优化自动保存策略：仅在内容变化后防抖 (Debounce) 保存，而不是固定 Interval。

## 2. 功能与用户体验 (UX)

### 2.1 AI 交互体验
- **中断生成**: 目前流式输出无法中断。建议添加 `AbortController` 支持，允许用户随时停止不满意的生成。
- **Diff 对比**: 在扩写或润色时，提供 "Accept/Reject" 模式，而不是直接覆盖原有内容。
- **重试机制**: AI 生成失败（如网络波动、JSON 解析错）时提供“重试”按钮。

### 2.2 数据安全
- **版本控制 (History)**: 为 Scene 内容添加简单的 Undo/Redo 或快照历史，防止 AI 覆盖后无法找回。
- **导入/导出**: 支持将整书导出为 Markdown/Word 格式，或导出 JSON 备份。

### 2.3 移动端适配
- **现状**: 布局主要针对桌面端（左右分栏）。
- **建议**: 增加 Drawer/Modal 模式，在小屏幕上折叠侧边栏。

## 3. 性能优化

### 3.1 虚拟滚动
- **现状**: 随着节点增多，`Outliner` 渲染可能会变慢。
- **建议**: 如果全书节点预计超过 500+，建议引入 `react-window` 或 `virtuoso` 进行虚拟渲染。

### 3.2 预加载
- **建议**: 在用户浏览大纲时，预先静默加载当前层级的正文预览（Lazy Load），减少点击时的等待感。

## 4. AI 效果优化 (Prompt Engineering)

### 4.1 结构化 Prompt 管理
- **现状**: Prompt 字符串硬编码在 Service 中。
- **建议**: 将 Prompt 提取为独立的模板文件或配置对象，方便迭代调优。

### 4.2 Few-Shot Learning
- **建议**: 在 Genesis 和 Expansion 的 Prompt 中加入 1-2 个高质量的 Example（少样本学习），显著提升输出格式的稳定性。

---

### 推荐优先级
1. **高**: 数据导出/备份 (防止丢失)、AI JSON 校验 (防止崩溃)。
2. **中**: Custom Hooks 重构、Undo/Redo。
3. **低**: 移动端适配、虚拟滚动。
