# 织梦机 AI (NovelWeaver)

一个面向长篇小说创作的本地优先 AI 写作工作台。

它支持从灵感创世到分层大纲、节点写作、AI 扩写与润色、版本回溯、一致性检查、任务队列和多格式导出。

## 核心能力

- AI 创世：从一句灵感生成书名、梗概、世界观、角色、初始卷结构
- 手动建书：可手动录入标题/梗概/世界观/角色并立即开始创作
- 分形大纲：卷 -> 剧情 -> 章 -> 场景
- 智能扩写：
  - 单节点扩写（只生成当前节点的下一层级）
  - 同层批量生成（额外按钮）
- 浮窗浏览：大纲、节点摘要、上级摘要、世界观、角色列表均可居中浮窗查看
- 编辑与历史：自动保存、撤销/重做、历史版本回滚
- AI 工具链：草稿生成、选区润色、任务队列（扩写/草稿/润色）
- 质量能力：一致性检查（孤儿节点、重复标题、角色覆盖等）
- 导入导出：JSON / Markdown / TXT / HTML

## 技术栈

- `React 19` + `TypeScript`
- `Vite 6`
- `Dexie` (IndexedDB)
- `Zustand` (状态管理)
- `@google/genai` + OpenAI 兼容接口
- `framer-motion` + `lucide-react`

## 快速开始

### 1. 环境要求

- Node.js >= 18
- npm >= 9

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量（可选）

```bash
cp .env.example .env.local
```

按需填写 `.env.local`：

- `VITE_GEMINI_API_KEY`：Gemini 默认密钥
- `VITE_OPENAI_API_KEY`：OpenAI 兼容模型默认密钥
- `VITE_API_KEY`：通用回退密钥（可选）

说明：
- 也可以完全不写环境变量，直接在应用「模型设置」里逐个模型填 API Key。
- 模型级 Key 优先级高于环境变量。

### 4. 启动开发环境

```bash
npm run dev
```

默认地址：`http://localhost:3000`

### 5. 构建生产包

```bash
npm run build
npm run preview
```

## 数据与隐私

### 敏感信息存放规则

- **不要提交** `.env.local` / `.env.*`
- **不要提交** `data/local/` 下的任何文件
- **不要提交** `data/` 下任何运行时数据 JSON 文件

### 应用数据写入位置

- 创作数据：实时同步到本地磁盘 `data/local/content.json`（包含 books/nodes/history/snapshots）
- 运行时缓存：浏览器 `IndexedDB`（库名：`NovelWeaverDB`）
- 设置数据：`data/local/models.json`（并在不可写时回退 `localStorage`）

## 环境变量读取策略（通用标准）

应用在运行时按以下顺序读取密钥：

1. 模型设置中填写的 API Key
2. `.env.local` 中的 provider 专属变量
   - Gemini: `VITE_GEMINI_API_KEY`
   - OpenAI 兼容: `VITE_OPENAI_API_KEY`
3. `.env.local` 中的 `VITE_API_KEY`（通用回退）

## 发布到 GitHub 前检查清单

1. 检查是否误提交环境变量文件

```bash
git status --short
```

2. 扫描潜在密钥字符串

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' \
"(api[_-]?key|apikey|access[_-]?token|secret|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|ghp_[A-Za-z0-9]{30,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)"
```

3. 确认以下路径不在暂存区

- `.env.local`
- `data/local/`

4. 构建与类型检查

```bash
npx tsc --noEmit
npm run build
```

## 常用命令

```bash
npm run dev      # 本地开发
npm run build    # 生产构建
npm run preview  # 预览构建产物
```

## 目录结构（简要）

```text
components/      UI 组件
hooks/           业务 Hook（AI 写作、任务队列等）
services/        AI 与导出/持久化服务
data/            安全默认模板（非用户私有数据）
db.ts            Dexie 数据库定义
store.ts         Zustand 全局状态
vite.config.ts   Vite 配置与开发期 API 中间件
```

## 许可证

本项目使用 MIT 许可证，详见 `LICENSE`。
