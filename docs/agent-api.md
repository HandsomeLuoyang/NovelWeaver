# Agent / API 文档

## 1. 这个项目是什么
织梦机 AI 是一个面向长篇小说创作的工作台。服务端暴露两层接口：
- `App API`: 给前端 UI 用的资源接口
- `Agent Gateway`: 给外部 agent 用的粗粒度工具接口

对于 `OpenClaw / Claude Code` 这类 agent，推荐优先使用 `Agent Gateway`，而不是自己拼底层 CRUD。

## 2. 设计原则
- 服务端是 agent 可见数据的权威事实源
- 所有会改稿的高风险操作都支持 `dryRun`
- 支持 `idempotencyKey`，避免 agent 重试时重复写入
- 结构/正文写入默认自动创建版本点
- 所有 agent 写入都会进入 `operation_journal`
- AI 类能力统一经由后端执行，agent 不需要直接碰模型厂商 API

## 3. 认证
Agent Gateway 需要 Bearer Token：
```http
Authorization: Bearer <agent-token>
```

首次启动若没有显式设置 `AGENT_BOOTSTRAP_TOKEN`，服务端会自动生成一个 bootstrap token 到：
- `data/local/agent-bootstrap-token.txt`

## 4. 作用域（Scopes）
| Scope | 含义 |
| --- | --- |
| `project.read` | 读取书籍、节点、审阅项、操作日志 |
| `project.write.content` | 改正文 |
| `project.write.structure` | 改结构、创建子节点 |
| `project.write.metadata` | 改摘要、元数据、事实 |
| `ai.run` | 运行 AI 工具 |
| `review.apply` | 应用审阅项 |
| `export.run` | 导出书籍 |
| `ops.rollback` | 创建/回滚版本点 |
| `models.read` | 读取模型信息 |
| `models.admin` | 创建 agent token、管理模型治理接口 |

## 5. 调用约定
### 5.1 工具调用体
`POST /api/v1/agent/tools/{name}` 的请求体：
```json
{
  "args": {},
  "dryRun": false,
  "idempotencyKey": "optional-stable-key",
  "sessionId": "optional-agent-run-id",
  "checkpointPolicy": "auto",
  "returnMode": "full"
}
```

字段说明：
- `args`: 工具参数
- `dryRun`: 只演练，不落库
- `idempotencyKey`: 幂等键，重复调用可直接复用已有结果
- `sessionId`: 把该工具执行挂到某个 `agent run`
- `checkpointPolicy`: `auto | skip | force`
- `returnMode`: `full | summary`

### 5.2 SSE
以下接口返回 `text/event-stream`：
- `GET /api/v1/ai/tasks/{id}/events`
- `GET /api/v1/agent/runs/{id}/events`

当前事件名为 `snapshot`，消息体是该任务/运行的最新完整快照。

## 6. 健康检查
### `GET /api/v1/health`
用途：确认服务可用。

示例响应：
```json
{
  "ok": true,
  "service": "agent-ready-backend",
  "storage": "sqlite",
  "tools": 18
}
```

## 7. Agent Gateway
### 7.1 列出工具
### `GET /api/v1/agent/tools`
返回当前 token 可见的工具定义，包括：
- `name`
- `description`
- `scopes`
- `sideEffect`
- `inputSchema`
- `outputSchema`

示例：
```bash
curl \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:4173/api/v1/agent/tools
```

### 7.2 调用工具
### `POST /api/v1/agent/tools/{name}`
推荐所有 agent 优先通过此接口调用项目能力。

示例：读取项目概览
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:4173/api/v1/agent/tools/read.project_overview \
  -d '{"returnMode":"full"}'
```

示例：直接改正文（带幂等键）
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:4173/api/v1/agent/tools/write.update_node_content \
  -d '{
    "args": {"nodeId":"scene-1","content":"新的场景正文"},
    "idempotencyKey": "scene-1-rewrite-v1",
    "checkpointPolicy": "auto",
    "returnMode": "full"
  }'
```

示例：先 dry run 再执行
```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:4173/api/v1/agent/tools/write.create_child_node \
  -d '{
    "args": {"parentId":"chapter-1","title":"新场景","summary":"冲突升级"},
    "dryRun": true,
    "returnMode": "summary"
  }'
```

### 7.3 Agent Runs
#### `POST /api/v1/agent/runs`
创建一个 agent run 会话。

请求示例：
```json
{
  "goal": "阅读项目并给出下一章方案",
  "caller": "claude-code"
}
```

#### `GET /api/v1/agent/runs`
读取最近的 runs。

#### `GET /api/v1/agent/runs/{id}`
读取单个 run。

#### `GET /api/v1/agent/runs/{id}/events`
订阅 run 的快照流。

### 7.4 Agent Tokens
#### `GET /api/v1/agent/tokens`
#### `POST /api/v1/agent/tokens`
这两个接口需要 `models.admin`。

创建 token 的请求体：
```json
{
  "name": "OpenClaw Writer",
  "scopes": ["project.read", "project.write.content", "ai.run", "review.apply"]
}
```

## 8. App API
这些接口主要给前端 UI 用，但 agent 在需要更细粒度资源时也能读。

### 8.1 书籍与快照
- `GET /api/v1/books`
- `GET /api/v1/books/{bookId}/tree`
- `GET /api/v1/books/{bookId}/snapshot`

`tree` 返回：
- `book`
- `nodes`
- `facts`
- `materials`
- `characterStates`
- `checkpoints`

`snapshot` 额外返回：
- `foreshadows`
- `references`

### 8.2 审阅项
- `GET /api/v1/reviews?bookId=...`
- `POST /api/v1/reviews/{reviewId}/apply`
- `POST /api/v1/reviews/{reviewId}/discard`

说明：
- AI proposal 结果默认进入 review inbox
- `apply` 会走共享落稿管道
- `discard` 只改审阅状态，不改正文

### 8.3 版本点
- `POST /api/v1/checkpoints`

请求示例：
```json
{
  "bookId": "book-1",
  "name": "发布前版本点"
}
```

### 8.4 导出
- `POST /api/v1/exports`

支持格式：
- `json`
- `markdown`
- `text`
- `html`
- `docx`
- `epub`

请求示例：
```json
{
  "bookId": "book-1",
  "format": "epub"
}
```

### 8.5 模型治理
- `GET /api/v1/models`
- `POST /api/v1/models/test`

`GET /api/v1/models` 返回的 `apiKey` 会脱敏，真实密钥不会回传。

### 8.6 AI 任务
- `GET /api/v1/ai/tasks`
- `POST /api/v1/ai/tasks`
- `GET /api/v1/ai/tasks/{id}`
- `GET /api/v1/ai/tasks/{id}/events`

请求示例：
```json
{
  "taskType": "drafting",
  "input": {
    "bookId": "book-1",
    "nodeId": "scene-1",
    "promptProfileId": "prompt-default"
  },
  "wait": true
}
```

## 9. 工具目录
以下工具由 `GET /api/v1/agent/tools` 动态返回。这里给出稳定清单和用途。

### 9.1 Read
| Tool | Scope | 用途 |
| --- | --- | --- |
| `read.project_overview` | `project.read` | 读取书籍概览与基础统计 |
| `read.book_tree` | `project.read` | 读取单书结构树、事实、素材、角色账本 |
| `read.node_context` | `project.read` | 读取节点上下文、祖先、线性前文和局部资料 |
| `read.review_items` | `project.read` | 读取待审阅结果 |

### 9.2 Write
| Tool | Scope | 用途 |
| --- | --- | --- |
| `write.update_node_content` | `project.write.content` | 直接改正文，自动记历史和版本点 |
| `write.update_node_summary` | `project.write.metadata` | 改节点摘要 |
| `write.create_child_node` | `project.write.structure` | 创建子节点 |
| `write.update_node_meta` | `project.write.metadata` | 改场景元数据 |
| `write.upsert_fact` | `project.write.metadata` | 新增或更新事实 |
| `write.apply_review_item` | `review.apply` | 应用 AI 审阅项 |

### 9.3 Ops
| Tool | Scope | 用途 |
| --- | --- | --- |
| `ops.create_checkpoint` | `ops.rollback` | 创建版本点 |
| `ops.rollback_checkpoint` | `ops.rollback` | 回滚到版本点 |
| `ops.export_book` | `export.run` | 导出整本书 |
| `ops.operation_journal` | `project.read` | 读取操作日志 |

### 9.4 AI
| Tool | Scope | 用途 |
| --- | --- | --- |
| `ai.generate_book` | `ai.run` + `project.write.structure` | 创世生成新书 |
| `ai.expand_node` | `ai.run` + `project.write.structure` | 生成下一层级 |
| `ai.draft_scene` | `ai.run` + `project.write.content` | 草稿生成 |
| `ai.polish_text` | `ai.run` + `project.write.content` | 润色正文或选区 |
| `ai.rewrite_scene` | `ai.run` | 生成多个改写版本 |
| `ai.project_qa` | `ai.run` + `project.read` | 基于项目资料问答 |
| `ai.creative_rescue` | `ai.run` | 卡文急救 |
| `ai.check_consistency` | `ai.run` + `project.read` | 一致性检查 |
| `ai.analyze_pacing` | `ai.run` + `project.read` | 节奏诊断 |
| `ai.build_publish_pack` | `ai.run` + `project.read` | 生成发布包 |

## 10. Proposal 与 Apply
AI 写作工具大多支持 `applyMode`：
- `proposal`: 生成结果进入 review inbox，不直接改稿
- `apply`: 直接写入服务端数据

推荐：
- 对大纲扩写、整段改写，优先 `proposal`
- 对可回滚的小改动，可在具备足够 scope 的前提下使用 `apply`

## 11. 推荐的 agent 调用流程
### 11.1 阅读并规划
1. `GET /api/v1/agent/tools`
2. `read.project_overview`
3. `read.book_tree`
4. `read.node_context`
5. `ai.project_qa` / `ai.creative_rescue`

### 11.2 先提案再落稿
1. `ai.draft_scene` with `applyMode=proposal`
2. `GET /api/v1/reviews`
3. `write.apply_review_item`

### 11.3 直接改稿但保证可回滚
1. `POST /api/v1/agent/runs`
2. `write.update_node_content` with `idempotencyKey`
3. `ops.operation_journal`
4. 必要时 `ops.rollback_checkpoint`

## 12. 错误语义
| 状态码 | 含义 |
| --- | --- |
| `401` | 缺少或无效 Bearer Token |
| `403` | 缺少所需 scope |
| `404` | 工具或资源不存在 |
| `500` | 服务端执行错误 |

当工具因权限失败时，响应示例：
```json
{ "error": "缺少作用域：project.write.content" }
```

## 13. 兼容接口
为了兼容旧前端和数据导入，服务端还保留：
- `GET/POST /api/storage/content`
- `GET/POST /api/v1/storage/content`
- `GET/POST /api/storage/models`
- `GET/POST /api/v1/storage/models`

新接入的 agent 不应依赖这些兼容接口，应优先使用 `/api/v1/agent/*` 与 `/api/v1/*`。
