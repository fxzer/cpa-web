# 部署指南

本文档说明如何将 **cliproxyapi-management**（管理前端）与配套的 **CLIProxyAPI**（主后端）部署到本地或服务器。

| 仓库 | 说明 |
|------|------|
| [fxzer/cliproxyapi-management](https://github.com/fxzer/cliproxyapi-management) | 本仓库：React 管理前端 |
| [fxzer/CLIProxyAPI](https://github.com/fxzer/CLIProxyAPI) | 主后端：代理 + Management API + 请求事件持久化 |

> **注意**：监控中心、凭证中心、请求监控等页面依赖 fxzer fork 中的扩展 API（如 `/v0/management/request-events`）。官方上游 bottle 可能不含这些路由，需使用 fxzer 分支自行构建。

---

## 架构概览

```
cliproxyapi-management (React)
    │  全部页面 → /v0/management/*
    ▼
CLIProxyAPI :8317
    代理 + Management API
    SQLite 请求事件持久化（默认开启）
    提供 management.html 静态页
```

| 组件 | 端口 | 是否必需 | 说明 |
|------|------|----------|------|
| CLIProxyAPI | 8317 | 是 | AI 代理、管理 API、请求监控数据 |
| 管理前端 | 随 CPA | 是（若用 Web UI） | 构建为 `management.html` |

请求监控数据由 CPA 内置 SQLite 存储，无需额外 sidecar 进程。

---

## 前置依赖

| 工具 | 版本建议 | 用途 |
|------|----------|------|
| Go | ≥ 1.24 | 编译 CLIProxyAPI |
| Node.js + npm | LTS | 构建前端 |
| git | — | 拉取代码 |

**本地 macOS（使用 deploy.sh）**：还需已安装 Homebrew 及 `cliproxyapi` 公式。

**Linux 服务器（使用 deploy.sh --target server）**：需 SSH 可达、systemd，且服务器上已有 CPA 的运行环境（默认 `/opt/cliproxyapi`）。

---

## 推荐目录结构

```text
~/projects/
├── CLIProxyAPI/              # 后端（fxzer fork）
└── cliproxyapi-management/   # 本仓库
```

拉取代码：

```bash
git clone https://github.com/fxzer/CLIProxyAPI.git
git clone https://github.com/fxzer/cliproxyapi-management.git
```

---

## 路径一：最简部署

### 1. 配置 CLIProxyAPI

```bash
cd CLIProxyAPI
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，至少设置：

```yaml
port: 8317

remote-management:
  secret-key: "你的管理密钥"    # 前端登录时使用
  allow-remote: true            # 非本机浏览器访问时需要

usage-statistics-enabled: true  # 请求监控需要

usage:
  enabled: true                 # 默认开启 SQLite 持久化
  # db-path: ""                 # 空则使用 <log-dir>/usage/usage.sqlite
```

### 2. 构建并启动后端

```bash
go build -o cliproxyapi ./cmd/server
./cliproxyapi -config config.yaml
```

### 3. 构建前端

```bash
cd ../cliproxyapi-management
npm install
npm run build
```

产物为单文件 HTML（`dist/index.html`），部署时需重命名为 `management.html`。

### 4. 安装静态页

```bash
mkdir -p /path/to/CLIProxyAPI/static
cp dist/index.html /path/to/CLIProxyAPI/static/management.html
```

若 CPA 已在运行，重启一次。

### 5. 访问

```
http://<host>:8317/management.html
```

输入 **管理密钥**（`remote-management.secret-key`）连接。

---

## 路径二：一键部署（推荐）

本仓库 `deploy.sh` 可自动构建并安装前端与 CLIProxyAPI。

### 本地 macOS

前提：已通过 Homebrew 安装 `cliproxyapi`，且 `../CLIProxyAPI` 为 fxzer fork 源码。

```bash
cd cliproxyapi-management
./deploy.sh
./deploy.sh --dry-run    # 预览步骤
```

脚本会：

1. `npm run build` 构建前端
2. 编译 CLIProxyAPI（darwin/arm64），安装到本地目录
3. 同步 `management.html` 到本地 static 目录
4. 通过 LaunchAgent 重启 CPA

访问地址：`http://127.0.0.1:8317/management.html`

### Linux 服务器（SSH）

```bash
export SSH_HOST=your-server
export BACKEND_ROOT=/path/to/CLIProxyAPI

./deploy.sh --target server
./deploy.sh --target server --frontend-only
```

---

## deploy.sh 命令参考

```bash
./deploy.sh                                    # 本地：前端 + CPA
./deploy.sh --frontend-only                    # 只部署前端
./deploy.sh --backend-only                     # 只部署 CPA
./deploy.sh --skip-build                       # 跳过构建
./deploy.sh --no-restart                       # 不重启服务
./deploy.sh --dry-run                          # 只打印动作

./deploy.sh --target server                    # 服务器：前端 + CPA + ds2api
./deploy.sh --target server --frontend-only
./deploy.sh --target server --backend-only
./deploy.sh --target server --ds2api-only
./deploy.sh --target both --frontend-only
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SSH_HOST` | `txy` | 服务器 SSH 别名 |
| `BACKEND_ROOT` | `../CLIProxyAPI` | CPA 源码路径 |
| `CPA_SRV_PATH` | `/opt/cliproxyapi` | 服务器 CPA 安装目录 |
| `CPA_CONFIG_PATH` | Homebrew 配置路径 | 本地 CPA 配置文件 |
| `MANAGEMENT_STATIC_PATH` | 自动推断 | 本地 static 目标 |
| `DS2API_ROOT` | `../ds2api` | ds2api 源码（服务器可选组件） |
| `DS2API_SRV_PATH` | `/opt/ds2api` | 服务器 ds2api 安装目录 |

---

## 路径三：完全手动部署

### 前端

```bash
cd cliproxyapi-management
npm install && npm run build
cp dist/index.html /opt/cliproxyapi/static/management.html
```

### 后端

```bash
cd CLIProxyAPI
go build -o cliproxyapi ./cmd/server
install -m 0755 cliproxyapi /opt/cliproxyapi/cliproxyapi
systemctl restart cliproxyapi
```

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
| 管理界面 | 浏览器打开 `:8317/management.html` | 出现登录页 |
| 请求事件 API | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8317/v0/management/request-events/status` | `401` 或 `200`，**不是** `404` |
| 持久化状态 | `curl -s -H "Authorization: Bearer <key>" http://127.0.0.1:8317/v0/management/request-events/status` | JSON 含 `enabled`、`event_count` |

`/v0/management/request-events` 返回 **404** 表示 CPA 不是 fxzer fork 或版本过旧。

---

## 按场景选择部署方式

| 场景 | 建议 |
|------|------|
| 本机开发调试 | 前端 `npm run dev`，后端 `./cliproxyapi` |
| macOS 日常使用 | `./deploy.sh` |
| 生产服务器 | `./deploy.sh --target server` |
| 无 SSH / 不用 deploy.sh | 路径一或路径三手动安装 |

---

## 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 401 无法登录 | 管理密钥错误 | 核对 CPA `config.yaml` 中 `secret-key` |
| 远程浏览器连不上 | 未开远程管理 | 设置 `remote-management.allow-remote: true` |
| 监控相关接口 404 | 使用了官方 CPA 而非 fxzer fork | 换 fxzer/CLIProxyAPI 构建 |
| 请求监控无数据 | 统计未开启 | 设置 `usage-statistics-enabled: true` 并重启 |
| 请求监控无历史 | 持久化关闭 | 确认 `usage.enabled` 为 true |
| deploy.sh 本地失败 | 未装 Homebrew cliproxyapi | 安装公式或使用路径一手动部署 |

---

## 安全提示

- **管理密钥**（Management Key）与 **API Keys**（代理对外鉴权）是两套不同的 key。
- 管理密钥会存入浏览器 `localStorage`（轻量混淆，非加密存储），仍应视为敏感信息。
- 开启 `allow-remote: true` 时请评估网络暴露面；建议配合防火墙或反向代理限制访问。
