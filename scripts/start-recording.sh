#!/usr/bin/env bash
# 一键启动录制:检查 cc-switch 当前 profile -> 启动 Recorder -> 停止后提醒切回直连。
# 用法:bash scripts/start-recording.sh
# 环境变量可覆盖默认值:
#   RECORDER_UPSTREAM_BASE_URL   上游网关 base URL(默认 https://api.deepseek.com/anthropic)
#   RECORDER_OUTPUT_ROOT         录制产物根目录(默认项目根目录下的 .recordings)
#   RECORDER_LISTEN              Recorder 监听地址 host:port(默认 127.0.0.1:4318)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECORDER_ENTRY="$SCRIPT_DIR/../src/index.mjs"

UPSTREAM_BASE_URL="${RECORDER_UPSTREAM_BASE_URL:-https://api.deepseek.com/anthropic}"
OUTPUT_ROOT="${RECORDER_OUTPUT_ROOT:-$SCRIPT_DIR/../.recordings}"
LISTEN="${RECORDER_LISTEN:-127.0.0.1:4318}"
RECORDER_BASE_URL="http://$LISTEN"

# --- 前置检查:Node 版本 ---
if ! command -v node >/dev/null 2>&1; then
  echo "错误:未找到 node,请先安装 Node.js >= 22" >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 22 ]; then
  echo "错误:需要 Node.js >= 22(当前 $(node --version))" >&2
  exit 1
fi

# --- 前置检查:cc-switch 当前 profile 是否已指向 Recorder ---
# 只读提示,不修改任何配置;cc-switch 的切换仍由人工在 GUI 中完成。
if [ -f "$HOME/.claude/settings.json" ]; then
  current_base="$(node -e '
    const fs = require("fs");
    const path = process.env.HOME + "/.claude/settings.json";
    try {
      const settings = JSON.parse(fs.readFileSync(path, "utf8"));
      const env = settings && settings.env || {};
      const key = Object.keys(env).find(k => k.toLowerCase() === "anthropic_base_url");
      if (key) process.stdout.write(env[key] || "");
    } catch {}
  ')"
  if [ -n "$current_base" ] && [ "${current_base%/}" != "$RECORDER_BASE_URL" ]; then
    echo "⚠  当前 cc-switch profile 的 ANTHROPIC_BASE_URL 是: $current_base"
    echo "   不是 Recorder 的 $RECORDER_BASE_URL —— 流量不会经过 Recorder!"
    echo "   请先在 cc-switch 中切换到 Recorder Profile。"
    if [ -t 0 ]; then
      read -r -p "仍然继续启动吗? [y/N] " choice
      case "$choice" in
        y | Y) ;;
        *) echo "已取消。" && exit 1 ;;
      esac
    fi
  elif [ -n "$current_base" ]; then
    echo "✓ 当前 profile 已指向 Recorder($RECORDER_BASE_URL)"
  else
    echo "⚠  无法从 ~/.claude/settings.json 读取 ANTHROPIC_BASE_URL,无法确认当前 profile"
  fi
else
  echo "⚠  未找到 ~/.claude/settings.json,无法确认当前 profile(cc-switch 是否已配置?)"
fi

mkdir -p "$OUTPUT_ROOT"

echo ""
echo "┌─ 开始录制 ──────────────────────────────────────"
echo "│ 上游:     $UPSTREAM_BASE_URL"
echo "│ 产物目录: $OUTPUT_ROOT"
echo "│ 监听:     $RECORDER_BASE_URL"
echo "│ 停止:     Ctrl+C(排空已接纳的交换后退出)"
echo "└─────────────────────────────────────────────────"
echo ""

reminder_printed=""
on_stop() {
  [ -n "$reminder_printed" ] && return
  reminder_printed=1
  echo ""
  echo "┌─ 录制进程已退出 ───────────────────────────────"
  echo "│ 产物目录: $OUTPUT_ROOT"
  echo "│ 需要直连时,请在 cc-switch 切回 Direct Profile。"
  echo "└─────────────────────────────────────────────────"
}
trap on_stop EXIT INT TERM

node "$RECORDER_ENTRY" \
  --upstream-base-url "$UPSTREAM_BASE_URL" \
  --output-root "$OUTPUT_ROOT" \
  --listen "$LISTEN"
