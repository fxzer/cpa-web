#!/usr/bin/env bash
# 将已构建的 management.html 安装到本地 CLIProxyAPI static 目录。
# 供 deploy.sh / deploy-server.sh 共用。

resolve_local_static_targets() {
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
  elif [[ -n "${CPA_CONFIG_PATH:-}" ]]; then
    targets+=("$(dirname "$CPA_CONFIG_PATH")/static/management.html")
  elif command -v brew >/dev/null 2>&1; then
    local brew_prefix
    brew_prefix="$(brew --prefix)"
    targets+=("$brew_prefix/etc/static/management.html")
  fi

  if [[ -n "${EXTRA_STATIC_DIRS:-}" ]]; then
    local extra
    for extra in $EXTRA_STATIC_DIRS; do
      targets+=("${extra%/}/management.html")
    done
  fi

  if ((${#targets[@]} == 0)); then
    echo "无法解析本地 static 目标路径，请设置 MANAGEMENT_STATIC_PATH 或 CPA_CONFIG_PATH。" >&2
    return 1
  fi

  printf '%s\n' "${targets[@]}" | awk '!seen[$0]++'
}

frontend_static_backup_file() {
  local path="$1"
  local label="$2"
  local dry_run="${3:-false}"
  local backup_dir="${BACKUP_DIR:-}"

  if [[ ! -e "$path" || "$dry_run" == true || -z "$backup_dir" ]]; then
    return 0
  fi
  mkdir -p "$backup_dir"
  cp -p "$path" "$backup_dir/$label"
}

install_built_frontend_static() {
  local built_html="$1"
  local dry_run="${2:-false}"

  if [[ ! -f "$built_html" ]]; then
    echo "前端构建产物不存在: $built_html" >&2
    return 1
  fi

  local target
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    echo "本地 static 目标: $target"
    frontend_static_backup_file "$target" "management.$(echo "$target" | shasum | awk '{print $1}').html" "$dry_run"
    if [[ "$dry_run" == true ]]; then
      echo "[dry-run] mkdir -p $(dirname "$target")"
      echo "[dry-run] install -m 0644 $built_html $target"
    else
      mkdir -p "$(dirname "$target")"
      install -m 0644 "$built_html" "$target"
    fi
  done < <(resolve_local_static_targets)
}
