# 部署指南

本文档说明如何将 **cpa-web**（管理前端）与配套的 **CLIProxyAPI**（主后端）部署到本地或服务器。

| 仓库 | 说明 |
|------|------|
| [fxzer/cpa-web](https://github.com/fxzer/cpa-web) | 本仓库：React 管理前端 |
| [fxzer/CLIProxyAPI](https://github.com/fxzer/CLIProxyAPI) | 主后端：代理 + Management API + 请求事件持久化 |

> **注意**：监控中心、凭证中心、请求监控等页面依赖 fxzer fork 中的扩展 API（如 `/v0/management/request-events`）。官方上游 bottle 可能不含这些路由，需使用 fxzer 分支自行构建。

---

## 架构概览

```
cpa-web (React)
    │  全部页面 → /v0/management/*
    ▼
CLIProxyAPI :8317
    代理 + Management API
    SQLite 请求事件持久化（默认开启）
    提供前端静态页（构建为 index.html，部署时重命名为 web.html）
```

| 组件 | 端口 | 是否必需 | 说明 |
|------|------|----------|------|
| CLIProxyAPI | 8317 | 是 | AI 代理、管理 API、请求监控数据 |
| 管理前端 | 随 CPA | 是（若用 Web UI） | 构建为 `web.html` |

请求监控数据由 CPA 内置 SQLite 存储，无需额外 sidecar 进程。

---

## 前置依赖

| 工具 | 版本建议 | 用途 |
|------|----------|------|
| Node.js + npm | LTS | 构建前端 |
| Go | ≥ 1.24 | 编译 CLIProxyAPI（后端用） |
| git | — | 拉取代码 |

**后端部署**还需 Go、SSH 等工具，请参考后端仓库说明。

---

## 推荐目录结构

```text
~/projects/
├── CLIProxyAPI/              # 后端（fxzer fork）
└── cpa-web/   # 本仓库
```

拉取代码：

```bash
git clone https://github.com/fxzer/CLIProxyAPI.git
git clone https://github.com/fxzer/cpa-web.git
```

---

## 方式一：最简手动部署

### 1. 构建前端

```bash
git clone https://github.com/fxzer/cpa-web.git
cd cpa-web
npm install
npm run build
```

产物为单文件 HTML：`dist/index.html`

### 2. 部署到后端

```bash
cp dist/index.html /opt/cliproxyapi/static/web.html
# 或使用脚本一步完成
./deploy.sh --to /opt/cliproxyapi/static
```

### 3. 访问

```
http://<host>:8317/web.html
```

> **后端（CLIProxyAPI）的搭建**请参考 [fxzer/CLIProxyAPI](https://github.com/fxzer/CLIProxyAPI) 仓库。

---

## 方式二：一键部署前端（推荐）

本仓库 `deploy.sh` 只负责前端构建与部署，不涉及后端。

```bash
cd cpa-web

# 只构建，产物在 dist/index.html
./deploy.sh

# 构建并部署到后端 static 目录（命名为 web.html）
./deploy.sh --to /opt/cliproxyapi/static

# 用已有产物部署（跳过构建）
./deploy.sh --skip-build --to ~/m/cpa/static

# 预览
./deploy.sh --dry-run --to /opt/cliproxyapi/static
```

### deploy.sh 命令参考

| 参数 | 说明 |
|------|------|
| `--to <目录>` | 构建后复制到后端 static 目录（自动命名为 web.html） |
| `--skip-build` | 跳过构建，直接部署已有的 dist/index.html |
| `--dry-run` | 只打印操作，不执行 |
| `-h` / `--help` | 显示帮助 |

> **后端部署**：CLIProxyAPI 的构建与安装请移步 [fxzer/CLIProxyAPI](https://github.com/fxzer/CLIProxyAPI) 仓库，本脚本不涉及。

---

## 方式三：完全手动部署

```bash
cd cpa-web
npm install && npm run build
cp dist/index.html /opt/cliproxyapi/static/web.html
```

然后重启 CPA 服务。

---

## 请求监控与持久化

请求监控页直接读取 CPA 的 Management API：

| API | 说明 |
|-----|------|
| `GET /v0/management/request-events` | 分页查询请求事件 |
| `GET /v0/management/request-events/status` | 持久化状态（事件数、写入队列等） |
| `GET /v0/management/request-events/export` | 导出 JSONL |
| `POST /v0/management/request-events/import` | 导入 JSONL |
| `DELETE /v0/management/request-events` | 清空事件 |
| `GET/PUT /v0/management/model-prices` | 模型定价 |
| `POST /v0/management/model-prices/sync-litellm` | 从 LiteLLM 同步定价 |

### 配置项

| 配置 | 说明 |
|------|------|
| `usage-statistics-enabled` | 为 `false` 时不记录请求事件 |
| `usage.enabled` | 为 `false` 时关闭 SQLite 持久化 |
| `usage.db-path` | SQLite 路径，默认 `<log-dir>/usage/usage.sqlite` |
| `usage.retention-days` | 自动清理天数，`0` 表示不清理 |

---

## 部署后验证

| 检查项 | 命令 | 期望 |
|--------|------|------|
| CPA 健康 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8317/healthz` | `200` |
| 管理界面 | 浏览器打开 `:8317/web.html` | 出现登录页 |
| 请求事件 API | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8317/v0/management/request-events/status` | `401` 或 `200`，**不是** `404` |
| 持久化状态 | `curl -s -H "Authorization: Bearer <key>" http://127.0.0.1:8317/v0/management/request-events/status` | JSON 含 `enabled`、`event_count` |

`/v0/management/request-events` 返回 **404** 表示 CPA 不是 fxzer fork 或版本过旧。

---

## 按场景选择部署方式

| 场景 | 建议 |
|------|------|
| 本机开发调试 | 前端 `npm run dev`，后端 `./cliproxyapi` |
| 本机构建部署 | `./deploy.sh --to <CPA静态目录>` |
| 服务器部署 | 在服务器上 `git clone` 后 `./deploy.sh --to /opt/cliproxyapi/static` |
| 不愿用脚本 | `npm run build` 后手动复制 `dist/index.html` |

---

## 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 401 无法登录 | 管理密钥错误 | 核对 CPA `config.yaml` 中 `secret-key` |
| 远程浏览器连不上 | 未开远程管理 | 设置 `remote-management.allow-remote: true` |
| 监控相关接口 404 | 使用了官方 CPA 而非 fxzer fork | 换 fxzer/CLIProxyAPI 构建 |
| 请求监控无数据 | 统计未开启 | 设置 `usage-statistics-enabled: true` 并重启 |
| 请求监控无历史 | 持久化关闭 | 确认 `usage.enabled` 为 true |
| deploy.sh 构建失败 | 未安装 Node.js 或依赖 | `npm install` 后再试 |

---

## 安全提示

- **管理密钥**（Management Key）与 **API Keys**（代理对外鉴权）是两套不同的 key。
- 管理密钥会存入浏览器 `localStorage`（轻量混淆，非加密存储），仍应视为敏感信息。
- 开启 `allow-remote: true` 时请评估网络暴露面；建议配合防火墙或反向代理限制访问。
