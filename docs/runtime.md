# 程序运行与部署

## 1. 运行模型
织梦机现在是一个单仓双层应用：
- `web`: Vite/React 前端，用于书籍编辑、任务审阅和工作台操作
- `api`: Node 服务，用于存储、Agent Gateway、AI 任务编排、导出与健康检查

前端开发态由 [scripts/dev.mjs](../scripts/dev.mjs) 同时拉起两端；生产态由 [server/index.ts](../server/index.ts) 提供静态资源和 `/api/*`。

## 2. 环境要求
- Node.js `22.13+` 或更高（推荐 Node 22 LTS）
- npm `9+`
- Docker `24+`（如使用容器）

说明：后端使用 `node:sqlite`，因此不建议低于 Node 22。

## 3. 环境变量
参考 [.env.example](../.env.example)。

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `4173` |
| `AGENT_SERVER_PORT` | 开发/Compose 兼容端口变量 | `4173` |
| `AGENT_DATA_DIR` | 数据目录 | `data/local` |
| `AGENT_BOOTSTRAP_TOKEN` | 首个 admin 级 agent token；为空时自动生成 | 空 |
| `VITE_GEMINI_API_KEY` | Gemini 默认回退 Key | 空 |
| `VITE_OPENAI_API_KEY` | OpenAI 兼容默认回退 Key | 空 |
| `VITE_API_KEY` | 通用回退 Key | 空 |

## 4. 本地开发
```bash
pon          # 可选，仅在你的网络环境需要代理时执行
npm ci
cp .env.example .env.local
npm run dev
```

行为说明：
- `npm run dev` 会先起 `node server/index.ts`
- 再起 Vite，并通过 `API_PROXY_TARGET` 把 `/api/*` 代理到后端
- 前端地址：`http://localhost:3000`
- 后端地址：`http://localhost:4173`

## 5. 本地生产预览
```bash
npm run build
node server/index.ts
```

访问：`http://localhost:4173`

这时由服务端直接托管 `dist/`，不再依赖 Vite preview。

## 6. Docker 开箱即用
```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

关键点：
- [docker-compose.yml](../docker-compose.yml) 已带健康检查
- [Dockerfile](../Dockerfile) 运行 `node server/index.ts`
- 数据目录映射为 Docker volume：`novelweaver_data`

健康检查地址：
- `GET /api/v1/health`

常用命令：
```bash
docker compose up -d --build
docker compose logs -f
docker compose ps
docker compose down
```

## 7. 数据目录与备份
运行时数据默认保存在 `data/local/`：
- `agent.sqlite`: 服务端主库
- `content.json`: 内容镜像备份
- `models.json`: 模型与设置镜像备份
- `agent-bootstrap-token.txt`: 自动生成的 bootstrap token（若未显式配置）

建议：
- 把 `data/local/` 视为私有运行目录
- 定期备份整个 `data/local/`
- 不要提交任何真实运行数据到 Git

## 8. 首次启动后的检查
### 健康检查
```bash
curl http://127.0.0.1:4173/api/v1/health
```

### 读取 bootstrap token
```bash
cat data/local/agent-bootstrap-token.txt
```

### 列出可用工具
```bash
curl \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:4173/api/v1/agent/tools
```

## 9. 测试与门禁
```bash
npm run typecheck
npm test
npm run build
```

当前门禁覆盖：
- 前端服务与组件测试
- Agent 后端工具合同测试
- 构建与类型检查

## 10. 常见问题
### Q1. 为什么浏览器里还有本地缓存？
为了保留本地优先体验、提升冷启动速度，并支持前端离线恢复。当前权威事实源已经是服务端 SQLite。

### Q2. 为什么 content.json 和 models.json 还存在？
它们是兼容旧数据和手工备份的镜像文件，主存储已经迁移到 `agent.sqlite`。

### Q3. bootstrap token 丢了怎么办？
显式设置 `AGENT_BOOTSTRAP_TOKEN` 后重启，或在受控环境下直接删除数据目录重新初始化；后者会重建空库，不建议在有数据时做。
