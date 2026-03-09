# 织梦机 AI

织梦机 AI 是一个面向长篇小说创作的本地优先写作工作台，现已升级为 `前端应用 + Agent-ready 后端`：UI 可以继续直接写作，外部 agent 也可以通过 HTTP 工具接口读项目、规划剧情、生成内容、直接改稿、导出结果。

## 它现在能做什么
- 从一句话灵感生成书籍、卷结构和场景草案
- 维护 `卷 -> 剧情 -> 章 -> 场景` 的长篇结构
- 执行草稿、润色、改写、卡文急救、一致性检查、节奏诊断、发布包生成
- 通过事实库、素材库、角色状态账本和提示词模板约束 AI
- 用 Agent Gateway 把项目能力暴露给 `OpenClaw / Claude Code` 一类外部 agent
- 通过 SQLite 持久化项目、审阅项、AI 任务、操作日志和 agent token

## 文档入口
- Agent / API 文档: [docs/agent-api.md](docs/agent-api.md)
- 程序运行与部署: [docs/runtime.md](docs/runtime.md)
- OpenAPI 草案: [docs/openapi.agent.yaml](docs/openapi.agent.yaml)
- 贡献说明: [CONTRIBUTING.md](CONTRIBUTING.md)
- 安全说明: [SECURITY.md](SECURITY.md)

## 快速开始
### 本地开发
```bash
# 如你的网络环境需要代理，可先执行
pon

npm ci
cp .env.example .env.local
npm run dev
```

默认地址：`http://localhost:3000`

### 本地单进程运行
```bash
npm ci
npm run build
node server/index.ts
```

默认地址：`http://localhost:4173`

### Docker
```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

健康检查：`GET /api/v1/health`

## 核心架构
- `src/`: React/Vite 前端与编辑器工作台
- `server/`: Node HTTP 服务，负责 App API、Agent Gateway、AI 任务、导出与存储
- `shared/`: 前后端共享合同
- `data/local/agent.sqlite`: 主数据库
- `data/local/content.json` / `models.json`: 镜像导出，兼容旧数据和手工备份
- `data/local/agent-bootstrap-token.txt`: 首次启动自动生成的 bootstrap token（若未显式提供）

## 常用命令
```bash
npm run dev
npm run test
npm run typecheck
npm run build
npm run preview
```

## 当前实现边界
- 第一版优先提供 `HTTP tools + SSE`，没有做 MCP 适配层
- 服务器已经是 agent 可见数据的权威事实源；Dexie 仍保留作前端缓存/离线支撑
- 高风险写入支持 `dryRun`、`idempotencyKey`、自动版本点和操作日志

## 发布前建议
```bash
npm run typecheck
npm test
npm run build
```
