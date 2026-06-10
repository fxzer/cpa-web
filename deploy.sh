#!/usr/bin/env bash
# 前端构建与部署脚本 — 构建并部署 web.html 到 cpa-core 后端 static 目录。
#
# 用法：
#   ./deploy.sh                                    # 构建到 dist/
#   ./deploy.sh --to <目录>                         # 构建并部署到后端静态目录
#   ./deploy.sh --skip-build --to <目录>            # 用已有产物部署
#   ./deploy.sh --dry-run                          # 预览
#
# 示例：
#   ./deploy.sh --to ~/cpa-core/static          # 部署到 cpa-core 后端 static 目录
#
# 环境变量：
#   NO_COLOR=true       禁用颜色输出

set -euo pipefail

# ── 颜色 ────────────────────────────────────────────────
if [[ -t 1 && "${NO_COLOR:-false}" != true ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  NC='\033[0m' # No Color
else
  RED=''; GREEN=''; CYAN=''; NC=''
fi

# ── 参数解析 ────────────────────────────────────────────
TO_DIR=""
SKIP_BUILD=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)
      if [[ -z "${2:-}" ]]; then
        echo -e "${RED}--to 需要指定目录路径${NC}" >&2
        exit 1
      fi
      TO_DIR="$2"; shift ;;
    --to=*)      TO_DIR="${1#--to=}" ;;
    --skip-build) SKIP_BUILD=true ;;
    --dry-run)   DRY_RUN=true ;;
    -h|--help)
      awk '/^# 用法：/,/^$/' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo -e "${RED}未知参数: $1${NC}" >&2
      echo "用法: ./deploy.sh [--to <目录>] [--skip-build] [--dry-run]" >&2
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILT_HTML="$SCRIPT_DIR/dist/index.html"

# ── 构建 ────────────────────────────────────────────────
if [[ "$SKIP_BUILD" != true ]]; then
  echo -e "${CYAN}==> 构建前端...${NC}"
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "  ${GREEN}[dry-run]${NC} npm run build"
  else
    npm --prefix "$SCRIPT_DIR" run build
    echo -e "  ${GREEN}✓${NC} 构建完成"
  fi
fi

if [[ "$DRY_RUN" != true && ! -f "$BUILT_HTML" ]]; then
  echo -e "${RED}构建产物不存在: $BUILT_HTML${NC}" >&2
  echo "提示: 如果已有构建产物，可加 --skip-build 跳过构建" >&2
  exit 1
fi

# 显示产物大小
BUILT_SIZE=""
if [[ -f "$BUILT_HTML" ]]; then
  BUILT_SIZE="$(du -h "$BUILT_HTML" | cut -f1)"
fi

# ── 部署 ────────────────────────────────────────────────
if [[ -n "$TO_DIR" ]]; then
  TARGET_PATH="${TO_DIR%/}/web.html"
  echo -e "${CYAN}==> 部署到 $TARGET_PATH${NC} ${GREEN}($BUILT_SIZE)${NC}"

  if [[ "$DRY_RUN" == true ]]; then
    echo -e "  ${GREEN}[dry-run]${NC} mkdir -p '$TO_DIR'"
    echo -e "  ${GREEN}[dry-run]${NC} install -m 0644 '$BUILT_HTML' '$TARGET_PATH'"
  else
    mkdir -p "$TO_DIR"

    # 备份旧文件
    if [[ -f "$TARGET_PATH" ]]; then
      cp "$TARGET_PATH" "${TARGET_PATH}.bak"
      echo -e "  ${GREEN}✓${NC} 已备份旧文件 → ${TARGET_PATH}.bak"
    fi

    install -m 0644 "$BUILT_HTML" "$TARGET_PATH"
    echo -e "  ${GREEN}✓${NC} 部署完成: $TARGET_PATH"
  fi
else
  echo -e "${CYAN}==>${NC} 构建产物: dist/index.html ${GREEN}($BUILT_SIZE)${NC}"
  echo "提示: 加 --to <目录> 可直接部署到后端 static 目录"
fi
