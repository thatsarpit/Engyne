#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv ]]; then
  python3.13 -m venv .venv
fi
source .venv/bin/activate
pip install -r api/requirements.txt >/dev/null

export PYTHONPATH="$ROOT_DIR/api:$ROOT_DIR"
export RUNTIME_ROOT=${RUNTIME_ROOT:-"$ROOT_DIR/runtime"}

mkdir -p "$ROOT_DIR/logs"

channels=(whatsapp telegram email sheets push)
for channel in "${channels[@]}"; do
  log_file="$ROOT_DIR/logs/dispatcher_${channel}.log"
  pid_file="$ROOT_DIR/runtime/dispatcher_${channel}.pid"
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "dispatcher $channel already running (pid $(cat "$pid_file"))"
    continue
  fi
  python "$ROOT_DIR/core/dispatcher_worker.py" "$channel" --runtime-root "$RUNTIME_ROOT" >>"$log_file" 2>&1 &
  echo $! >"$pid_file"
  echo "started dispatcher $channel (pid $!)"
done
