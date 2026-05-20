#!/usr/bin/env bash
# 一键部署本地前端静态文件和 Homebrew 版 CLIProxyAPI 后端。
#
# 默认行为：
# - 构建当前前端项目，替换 CLIProxyAPI 正在读取的 management.html
# - 从 /Users/fxj/n/CLIProxyAPI 构建后端，替换 Homebrew 服务二进制
# - 重启 brew services cliproxyapi
# - 检查 /management.html 和几个管理接口是否已存在
#
# 常用参数：
#   ./deploy.sh                         # 完整部署
#   ./deploy.sh --frontend-only          # 只部署前端静态文件
#   ./deploy.sh --backend-only           # 只部署后端二进制并重启
#   ./deploy.sh --no-restart             # 替换后端后不重启
#   ./deploy.sh --dry-run                # 只打印动作，不真正替换
#
# 可选环境变量：
#   BACKEND_ROOT=/path/to/CLIProxyAPI
#   BACKEND_BUILD_MODE=auto|current|clean-head
#   auto（默认）: 使用当前工作区构建（含未提交/未跟踪文件）
#   current: 同 auto
#   clean-head: 仅用 git HEAD 快照构建（不含未提交改动）
#   CPA_CONFIG_PATH=/opt/homebrew/etc/cliproxyapi.conf
#   MANAGEMENT_STATIC_PATH=/custom/static/or/management.html
#   EXTRA_STATIC_DIRS="/path/a /path/b"

set -euo pipefail

FRONTEND_ONLY=false
BACKEND_ONLY=false
NO_RESTART=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --frontend-only) FRONTEND_ONLY=true ;;
    --backend-only) BACKEND_ONLY=true ;;
    --no-restart) NO_RESTART=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help)
      sed -n '1,31p' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$FRONTEND_ONLY" == true && "$BACKEND_ONLY" == true ]]; then
  echo "--frontend-only 和 --backend-only 不能同时使用。" >&2
  exit 1
fi

run() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    echo
  else
    "$@"
  fi
}

log_step() {
  echo
  echo "==> $*"
}

resolve_realpath() {
  python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ROOT="$SCRIPT_DIR"
BACKEND_ROOT="${BACKEND_ROOT:-/Users/fxj/n/CLIProxyAPI}"
BACKEND_BUILD_MODE="${BACKEND_BUILD_MODE:-current}"

if ! command -v brew >/dev/null 2>&1; then
  echo "未找到 brew，无法定位 Homebrew 服务。" >&2
  exit 1
fi

BREW_PREFIX="$(brew --prefix)"
CPA_CONFIG_PATH="${CPA_CONFIG_PATH:-$BREW_PREFIX/etc/cliproxyapi.conf}"
BREW_SERVICE_NAME="cliproxyapi"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/.cliproxyapi-deploy-backups}"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"

resolve_static_targets() {
  local targets=()
  if [[ -n "${MANAGEMENT_STATIC_PATH:-}" ]]; then
    local cleaned="$MANAGEMENT_STATIC_PATH"
    if [[ "$(basename "$cleaned")" == "management.html" ]]; then
      targets+=("$cleaned")
    else
      targets+=("$cleaned/management.html")
    fi
  elif [[ -n "${WRITABLE_PATH:-}" ]]; then
    targets+=("${WRITABLE_PATH%/}/static/management.html")
  elif [[ -n "${writable_path:-}" ]]; then
    targets+=("${writable_path%/}/static/management.html")
  else
    targets+=("$(dirname "$CPA_CONFIG_PATH")/static/management.html")
  fi

  if [[ -n "${EXTRA_STATIC_DIRS:-}" ]]; then
    local extra
    for extra in $EXTRA_STATIC_DIRS; do
      targets+=("${extra%/}/management.html")
    done
  fi

  printf '%s\n' "${targets[@]}" | awk '!seen[$0]++'
}

backup_file() {
  local path="$1"
  local label="$2"
  if [[ ! -e "$path" || "$DRY_RUN" == true ]]; then
    return
  fi
  mkdir -p "$BACKUP_DIR"
  cp -p "$path" "$BACKUP_DIR/$label"
}

deploy_frontend() {
  log_step "构建并部署前端静态文件"
  cd "$FRONTEND_ROOT"

  run npm run build

  local built_html="$FRONTEND_ROOT/dist/management.html"
  if [[ "$DRY_RUN" != true && ! -f "$built_html" ]]; then
    echo "前端构建产物不存在: $built_html" >&2
    exit 1
  fi

  local target
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    echo "静态文件目标: $target"
    backup_file "$target" "management.$(echo "$target" | shasum | awk '{print $1}').html"
    run mkdir -p "$(dirname "$target")"
    run install -m 0644 "$built_html" "$target"
  done < <(resolve_static_targets)
}

prepare_backend_build_dir() {
  local mode="$1"
  case "$mode" in
    auto|current)
      if [[ -n "$(git -C "$BACKEND_ROOT" status --porcelain)" ]]; then
        echo "后端工作区有未提交改动，将使用当前工作区构建（含未跟踪文件）。" >&2
      fi
      echo "$BACKEND_ROOT"
      ;;
    clean-head)
      local tmp_dir
      tmp_dir="$(mktemp -d -t cliproxyapi-build-src.XXXXXX)"
      git -C "$BACKEND_ROOT" archive --format=tar HEAD | tar -x -C "$tmp_dir"
      echo "$tmp_dir"
      ;;
    *)
      echo "BACKEND_BUILD_MODE 只能是 auto、current 或 clean-head。" >&2
      exit 1
      ;;
  esac
}

deploy_backend() {
  log_step "构建并部署后端二进制"

  if [[ ! -d "$BACKEND_ROOT" ]]; then
    echo "后端目录不存在: $BACKEND_ROOT" >&2
    exit 1
  fi
  if [[ ! -d "$BACKEND_ROOT/.git" ]]; then
    echo "后端目录不是 git 仓库: $BACKEND_ROOT" >&2
    exit 1
  fi
  if ! command -v go >/dev/null 2>&1; then
    echo "未找到 go，无法构建后端。" >&2
    exit 1
  fi
  if ! brew list --formula "$BREW_SERVICE_NAME" >/dev/null 2>&1; then
    echo "未安装 Homebrew 公式: $BREW_SERVICE_NAME" >&2
    exit 1
  fi
  if [[ ! -e "$CPA_CONFIG_PATH" ]]; then
    echo "配置文件不存在: $CPA_CONFIG_PATH" >&2
    exit 1
  fi

  local opt_bin install_bin build_dir tmp_bin version commit build_date ldflags cleanup_build=false
  opt_bin="$(brew --prefix "$BREW_SERVICE_NAME")/bin/cliproxyapi"
  install_bin="$(resolve_realpath "$opt_bin")"
  build_dir="$(prepare_backend_build_dir "$BACKEND_BUILD_MODE")"
  if [[ "$build_dir" != "$BACKEND_ROOT" ]]; then
    cleanup_build=true
  fi

  tmp_bin="$(mktemp -t cliproxyapi-build.XXXXXX)"
  version="$(git -C "$BACKEND_ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)"
  commit="$(git -C "$BACKEND_ROOT" rev-parse --short HEAD 2>/dev/null || echo none)"
  build_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  ldflags="-s -w"
  ldflags+=" -X main.Version=${version}"
  ldflags+=" -X main.Commit=${commit}"
  ldflags+=" -X main.BuildDate=${build_date}"
  ldflags+=" -X main.DefaultConfigPath=${CPA_CONFIG_PATH}"

  echo "后端源码: $BACKEND_ROOT"
  echo "构建目录: $build_dir"
  echo "配置文件: $CPA_CONFIG_PATH"
  echo "二进制目标: $install_bin"
  echo "版本: $version"

  run go -C "$build_dir" build -trimpath -ldflags "$ldflags" -o "$tmp_bin" ./cmd/server

  backup_file "$install_bin" "cliproxyapi"
  run install -m 0755 "$tmp_bin" "$install_bin.new"
  run mv "$install_bin.new" "$install_bin"
  rm -f "$tmp_bin"

  if [[ "$cleanup_build" == true ]]; then
    rm -rf "$build_dir"
  fi

  if [[ "$NO_RESTART" != true ]]; then
    log_step "重启 Homebrew 服务"
    run brew services restart "$BREW_SERVICE_NAME"
  else
    echo "已跳过重启。"
  fi
}

wait_for_http() {
  local url="$1"
  local expected_any="$2"
  local code=""
  local i
  for i in {1..30}; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    if [[ " $expected_any " == *" $code "* ]]; then
      echo "$code"
      return 0
    fi
    sleep 1
  done
  echo "$code"
  return 1
}

smoke_check() {
  if [[ "$DRY_RUN" == true || "$NO_RESTART" == true || "$FRONTEND_ONLY" == true ]]; then
    return
  fi

  log_step "部署后自检"
  local base_url="http://127.0.0.1:8317"
  local code

  code="$(wait_for_http "$base_url/management.html" "200 401 403")" || {
    echo "management.html 自检失败，最后状态码: $code" >&2
    exit 1
  }
  echo "management.html: $code"

  local endpoint
  for endpoint in /v0/management/usage /v0/management/auth-refresh-queue /v0/management/usage-queue; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url$endpoint" 2>/dev/null || true)"
    echo "$endpoint: $code"
    if [[ "$code" == "404" || "$code" == "000" ]]; then
      echo "接口不存在或服务不可达: $endpoint" >&2
      exit 1
    fi
  done

  code="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/v0/management/auth-files/models-config?name=__deploy_probe__.json" 2>/dev/null || true)"
  echo "/v0/management/auth-files/models-config: $code"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    echo "models-config 路由不存在。若后端有未提交改动，请确认 deploy.sh 使用 current 模式构建。" >&2
    exit 1
  fi
}

main() {
  echo "前端目录: $FRONTEND_ROOT"
  echo "后端目录: $BACKEND_ROOT"
  echo "备份目录: $BACKUP_DIR"

  if [[ "$BACKEND_ONLY" != true ]]; then
    deploy_frontend
  fi
  if [[ "$FRONTEND_ONLY" != true ]]; then
    deploy_backend
  fi
  smoke_check

  echo
  echo "部署完成。"
  if [[ -d "$BACKUP_DIR" ]]; then
    echo "备份位置: $BACKUP_DIR"
  fi
}

main
