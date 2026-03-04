# 织梦机 AI (NovelWeaver)

本项目是一个面向长篇小说创作的本地优先 AI 写作工作台，覆盖从创意创世到大纲拆解、场景写作、质检发布的完整链路。

## 1. 功能总览

### 1.1 创世与建书
- AI 创世：输入灵感后自动生成书名、梗概、世界观、角色、初始卷结构。
- 手动建书：可手动录入标题、梗概、世界观、角色并直接开始创作。
- 书籍信息可编辑：支持后续修改书名与设定。

### 1.2 大纲与节点管理
- 分形结构：`卷 -> 剧情 -> 章 -> 场景`。
- 节点扩写：
  - 单节点扩写（只生成当前节点的下一层级）。
  - 同层批量扩写（单独按钮触发）。
- 节点回收站：删除后可恢复。
- 场景看板：场景维度管理与调整。
- 节点快捷操作支持图标/文字模式切换，并可持久化。

### 1.3 写作与 AI 工作流
- 一键草稿：按上下文生成场景草稿。
- 选区润色：只润色用户选中的文本片段。
- 卡文急救包：生成推进方向、冲突升级、反转、对白钩子等灵感。
- AI 任务队列：扩写/草稿/润色任务排队执行。
- 提示词管理：支持多份提示词模板管理与切换。
- 模型中控：支持 Gemini 与 OpenAI 兼容模型配置。

### 1.4 质量、事实库与发布
- 一致性检查：角色、结构、命名等质量问题检查。
- 事实库（Fact Library）：
  - 事实条目与候选事实管理。
  - 在生成、扩写、润色环节注入事实约束。
- 发布工作流：发布前质量门禁、流程检查。
- 导出能力：`JSON / Markdown / TXT / HTML`。

### 1.5 数据安全与恢复
- 本地磁盘存储 + 浏览器存储双保险。
- 自动恢复快照轮转，支持手动恢复。
- 数据完整性校验（备份结构、引用关系检查）。

---

## 2. 技术栈与架构

### 2.1 技术栈
- React 19 + TypeScript
- Vite 6
- Dexie (IndexedDB)
- Zustand
- @google/genai + OpenAI 兼容接口
- Vitest + Testing Library

### 2.2 数据与存储路径
- 运行主库：IndexedDB（`NovelWeaverDB`）
- 本地磁盘内容备份：`data/local/content.json`
- 模型/设置备份：`data/local/models.json`
- 浏览器兜底缓存：`localStorage`

### 2.3 本地存储 API
前端通过以下路径读写数据（由 Vite 中间件提供）：
- `GET/POST /api/storage/content`
- `GET/POST /api/storage/models`

说明：
- `npm run dev` 与 `npm run preview` 都会挂载该中间件。
- 若部署环境没有这两个 API，应用会回退到 `localStorage`，但不建议用于正式长期数据托管。

---

## 3. 开发实用方法

### 3.1 环境要求
- Node.js 20+（与 CI 对齐，CI 使用 Node 20）
- npm 9+
- macOS 推荐安装 Homebrew

### 3.2 快速启动
```bash
# 如果你所在网络需要代理，可先执行（可选）
pon

# 安装依赖（推荐用 lockfile 一致安装）
npm ci

# 环境变量模板
cp .env.example .env.local

# 启动开发环境
npm run dev
```

默认访问：`http://localhost:3000`

### 3.3 常用开发命令
```bash
npm run dev          # 本地开发
npm run test         # 单次测试
npx tsc --noEmit     # 类型检查
npm run build        # 生产构建
npm run preview      # 本地预览（含 /api/storage 中间件）
```

### 3.4 GitHub CLI（gh）安装与使用
已验证本机安装方式（macOS）：
```bash
brew install gh
gh --version
```

首次登录：
```bash
gh auth login
gh auth status
```

常用：
```bash
gh repo view
gh pr create
gh pr checks <pr-number>
```

### 3.5 开发提交前建议
```bash
npx tsc --noEmit
npm run test
npm run build
```

---

## 4. 部署实用方法

### 4.1 推荐方案：Node 进程运行 preview（最省事）
适用于单机/内网部署，保留 `/api/storage/*` 文件读写能力。

```bash
npm ci
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

然后用 Nginx/Caddy 反代到 `4173`。

### 4.2 Nginx 反代示例
```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### 4.3 GitHub Actions CI
已配置工作流：`.github/workflows/ci.yml`
- 触发：`push/pull_request` 到 `public-main`
- 步骤：`npm ci -> tsc -> test -> build`

### 4.4 数据目录注意事项
- `data/local/` 仅本地实例私有使用。
- 不要把生产实例数据目录纳入 Git。
- 请定期备份 `data/local/`（尤其是 `content.json`、`models.json`）。

---

## 5. 环境变量

`.env.example`：
- `VITE_GEMINI_API_KEY`
- `VITE_OPENAI_API_KEY`
- `VITE_API_KEY`（通用回退）

读取优先级：
1. 模型设置中手工填写的 API Key
2. provider 专属变量
3. `VITE_API_KEY`

---

## 6. 安全与敏感信息

### 6.1 严禁提交
- `.env.local` / `.env.*`（保留 `.env.example`）
- `data/local/` 下任何运行时数据
- API Key / Token / 私钥

### 6.2 提交前扫描
```bash
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**' \
"(api[_-]?key|apikey|access[_-]?token|secret|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\\-_]{20,}|ghp_[A-Za-z0-9]{30,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)"
```

---

## 7. 常见问题（实战）

### 7.1 CI 报 “Cannot find module ... / no exported member ...”
通常是“引用已提交，但依赖文件或类型未提交”。  
先本地跑：
```bash
npx tsc --noEmit
```
再确认缺失文件已 `git add` 并推送。

### 7.2 浏览器报 `Failed to fetch`
常见原因：
- API Key 未配置；
- 代理/网络不通；
- 部署环境未提供 `/api/storage/*`；
- 跨域或 HTTPS 证书问题。

建议按顺序排查：模型设置 -> 网络代理 -> 后端/反代日志。

### 7.3 Clone 后为什么没有示例文章数据
仓库默认不携带用户私有创作数据；运行后数据会写入本地 `data/local/` 与浏览器存储。

---

## 8. 目录结构（简要）
```text
src/             应用源码根目录
src/components/  UI 组件
src/hooks/       业务 Hook
src/services/    AI、导出、持久化服务
src/plugins/     插件机制与内置插件
tests/           单元/组件测试
src/db.ts        Dexie 数据层
src/store.ts     Zustand 状态层
vite.config.ts   Vite + 本地存储 API 中间件
```

## License
MIT（见 [LICENSE](LICENSE)）
