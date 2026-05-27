# 部署指南

本文档说明如何将 **cliproxyapi-management**（管理前端）与配套的 **CLIProxyAPI**（主后端）及可选的 **usage-service** 部署到本地或服务器。

| 仓库 | 说明 |
|------|------|
| [fxzer/cliproxyapi-management](https://github.com/fxzer/cliproxyapi-management) | 本仓库：React 前端 + 可选 usage-service |
| [fxzer/CLIProxyAPI](https://github.com/fxzer/CLIProxyAPI) | 主后端：代理 + Management API |

> **注意**：监控中心、凭证中心、请求监控等页面依赖 fxzer fork 中的扩展 API（如 `/v0/management/usage`）。官方上游 bottle 可能不含这些路由，需使用 fxzer 分支自行构建。

---

## 架构概览

```
cliproxyapi-management (React)
    │  大部分页面 → /v0/management/*
    ▼
CLIProxyAPI :8317                 主后端（代理 + Management API）
    │  提供 management.html 静态页

usage-service (cpa-manager) :18317   可选 sidecar
    │  轮询 CPA usage-queue → SQLite
    ▼
「请求监控」页（可配置直连此服务）
```

| 组件 | 端口 | 是否必需 | 说明 |
|------|------|----------|------|
| CLIProxyAPI | 8317 | 是 | AI 代理与管理 API |
| 管理前端 | 随 CPA | 是（若用 Web UI） | 构建为 `management.html` |
| usage-service | 18317 | 否 | 长期请求级监控、费用估算、导入导出 |

不部署 usage-service 时，「请求监控」降级为读取 CPA 短期内存队列；其它页面不受影响。

---

## 前置依赖

| 工具 | 版本建议 | 用途 |
|------|----------|------|
| Go | ≥ 1.24 | 编译 CLIProxyAPI、usage-service |
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

## 路径一：最简部署（仅管理界面）

适合先跑通管理 UI，暂不需要长期请求监控。

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

本仓库 `deploy.sh` 可自动构建并安装前端、CLIProxyAPI、usage-service。

### 本地 macOS

前提：已通过 Homebrew 安装 `cliproxyapi`，且 `../CLIProxyAPI` 为 fxzer fork 源码。

```bash
cd cliproxyapi-management

# 全量：前端 + CPA + usage-service
./deploy.sh

# 不需要长期监控时跳过 usage-service
./deploy.sh --skip-usage-service

# 预览步骤，不实际执行
./deploy.sh --dry-run
```

脚本会：

1. `npm run build` 构建前端
2. 编译 CLIProxyAPI（darwin/arm64），替换 Homebrew 中的二进制
3. 同步 `management.html` 到本地 static 目录
4. 编译 usage-service，安装到 `~/.local/cpa-manager`，通过 LaunchAgent 启动

访问地址：

| 服务 | 地址 |
|------|------|
| 管理界面 | `http://127.0.0.1:8317/management.html` |
| usage-service | `http://127.0.0.1:18317/health` |

### Linux 服务器（SSH）

前提：服务器上已有 `cliproxyapi` systemd 服务，安装路径默认 `/opt/cliproxyapi`；本机已配置 SSH 别名。

```bash
cd cliproxyapi-management

export SSH_HOST=your-server          # ~/.ssh/config 中的 Host 名
export BACKEND_ROOT=/path/to/CLIProxyAPI

# 全量部署到服务器
./deploy.sh --target server

# 只更新前端
./deploy.sh --target server --frontend-only

# 只更新 usage-service
./deploy.sh --target server --usage-service-only
```

脚本通过 scp 推送二进制与 `management.html`，并 `systemctl restart` 相关服务。

---

## deploy.sh 命令参考

```bash
./deploy.sh                                    # 本地：前端 + CPA + usage-service
./deploy.sh --frontend-only                    # 只部署前端
./deploy.sh --backend-only                     # 只部署 CPA + usage-service
./deploy.sh --usage-service-only               # 只部署 usage-service
./deploy.sh --skip-usage-service               # 跳过 usage-service
./deploy.sh --skip-build                       # 跳过构建，使用已有产物
./deploy.sh --no-restart                       # 不重启服务
./deploy.sh --dry-run                          # 只打印动作

./deploy.sh --target server                    # 服务器：前端 + CPA + ds2api + usage-service
./deploy.sh --target server --frontend-only
./deploy.sh --target server --backend-only
./deploy.sh --target server --usage-service-only
./deploy.sh --target server --ds2api-only
./deploy.sh --target both --frontend-only      # 本地 + 服务器同时更新前端
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SSH_HOST` | `txy` | 服务器 SSH 别名 |
| `BACKEND_ROOT` | `../CLIProxyAPI` | CPA 源码路径 |
| `USAGE_SERVICE_ROOT` | 本仓库 `usage-service/` | usage-service 源码 |
| `CPA_SRV_PATH` | `/opt/cliproxyapi` | 服务器 CPA 安装目录 |
| `CPA_MANAGER_SRV_PATH` | `/opt/cpa-manager` | 服务器 usage-service 安装目录 |
| `CPA_MANAGER_LOCAL_ROOT` | `~/.local/cpa-manager` | 本地 usage-service 安装目录 |
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

### usage-service（可选）

```bash
cd cliproxyapi-management/usage-service
go build -o cpa-manager ./cmd/cpa-manager

mkdir -p /opt/cpa-manager/data
cp deploy/config.json.example /opt/cpa-manager/config.json
```

编辑 `/opt/cpa-manager/config.json`：

```json
{
  "httpAddr": "0.0.0.0:18317",
  "dataDir": "./data",
  "cpaUpstreamUrl": "http://127.0.0.1:8317",
  "panelPath": "/opt/cliproxyapi/static/management.html",
  "managementKeyFile": "./management.key"
}
```

配置管理密钥并启动：

```bash
echo "你的管理密钥" > /opt/cpa-manager/management.key
chmod 600 /opt/cpa-manager/management.key
install -m 0755 cpa-manager /opt/cpa-manager/cpa-manager

sed 's|__CPA_MANAGER_SRV_PATH__|/opt/cpa-manager|g' \
  deploy/cpa-manager.service > /etc/systemd/system/cpa-manager.service

systemctl daemon-reload
systemctl enable --now cpa-manager
```

**本地 macOS** 可使用 LaunchAgent，模板见 `usage-service/deploy/com.cpa-manager.plist`。

---

## usage-service 与请求监控

### 两种数据源

| 模式 | 条件 | 数据特点 |
|------|------|----------|
| `usage-service` | 启用且能连上 `:18317` | SQLite 持久化，支持导入导出、模型定价 |
| `management-api` | 未启用或探测失败 | 读取 CPA `/v0/management/usage`，短期聚合 |

### 前端配置

管理界面 → **请求监控 → 设置**：

1. 启用 usage-service
2. 服务地址填 `http://<host>:18317`
3. 保存后页面会自动探测并切换数据源

### 配置 usage-service 管理密钥

与 CPA 的 `remote-management.secret-key` 相同（明文）。任选其一：

| 方式 | 路径 / 操作 |
|------|-------------|
| 密钥文件 | 本地 `~/.local/cpa-manager/management.key`；服务器 `/opt/cpa-manager/management.key` |
| 环境变量 | 服务器 `/opt/cpa-manager/cpa-manager.env` 中设 `CPA_MANAGEMENT_KEY=...` |
| 前端向导 | 请求监控页通过 `/setup` 配置 |

未配置密钥时 usage-service 仍可启动，但采集器不会连接 CPA。

### 安装路径与进程管理

| 环境 | 安装目录 | 进程管理 | 配置文件 |
|------|----------|----------|----------|
| 本地 macOS | `~/.local/cpa-manager/` | LaunchAgent `com.local.cpa-manager` | `config.json` |
| Linux 服务器 | `/opt/cpa-manager/` | systemd `cpa-manager.service` | `config.json` |

首次部署时 `config.json` 由脚本或模板自动生成；**已有配置文件不会被覆盖**。

部署模板位于 `usage-service/deploy/`：

- `config.json.example` — 默认配置
- `cpa-manager.service` — systemd 单元
- `com.cpa-manager.plist` — macOS LaunchAgent

---

## 部署后验证

| 检查项 | 命令 | 期望 |
|--------|------|------|
| CPA 健康 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8317/healthz` | `200` |
| 管理界面 | 浏览器打开 `:8317/management.html` | 出现登录页 |
| 监控 API | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8317/v0/management/usage` | `401` 或 `200`，**不是** `404` |
| usage-service | `curl -s http://127.0.0.1:18317/usage-service/info` | 含 `"service":"cpa-manager"` |

`/v0/management/usage` 返回 **404** 表示 CPA 不是 fxzer fork 或版本过旧。

---

## 按场景选择部署方式

| 场景 | 建议 |
|------|------|
| 本机开发调试 | 前端 `npm run dev`，后端 `./cliproxyapi`；不必部署 usage-service |
| macOS 日常使用 | `./deploy.sh` 或 `./deploy.sh --skip-usage-service` |
| 生产服务器 | `./deploy.sh --target server` |
| 只要 UI、不要监控 | 路径一最简部署，或 `./deploy.sh --skip-usage-service` |
| 无 SSH / 不用 deploy.sh | 路径三手动逐步安装 |

---

## 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 401 无法登录 | 管理密钥错误 | 核对 CPA `config.yaml` 中 `secret-key` |
| 远程浏览器连不上 | 未开远程管理 | 设置 `remote-management.allow-remote: true` |
| 监控相关接口 404 | 使用了官方 CPA 而非 fxzer fork | 换 fxzer/CLIProxyAPI 构建 |
| 请求监控无历史数据 | usage-service 未部署或未配置 | 部署 cpa-manager，检查密钥与服务地址 |
| usage-service 连接失败 | 端口不可达或未启动 | `curl http://127.0.0.1:18317/health`；检查 systemd / LaunchAgent 状态 |
| deploy.sh 本地失败 | 未装 Homebrew cliproxyapi | 安装公式或使用路径一/三手动部署 |

---

## 安全提示

- **管理密钥**（Management Key）与 **API Keys**（代理对外鉴权）是两套不同的 key。
- 管理密钥会存入浏览器 `localStorage`（轻量混淆，非加密存储），仍应视为敏感信息。
- 开启 `allow-remote: true` 时请评估网络暴露面；建议配合防火墙或反向代理限制访问。
