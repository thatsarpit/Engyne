#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.node}"
if [[ ! -f "$ENV_FILE" && -f "$ROOT_DIR/deploy/env.node.example" ]]; then
  cp "$ROOT_DIR/deploy/env.node.example" "$ENV_FILE"
  echo "Wrote $ENV_FILE. Edit it before starting the node."
fi

PYTHON_BIN="${PYTHON_BIN:-python3.13}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python3"
fi
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11+."
  exit 1
fi

if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
source .venv/bin/activate
pip install -r api/requirements.txt >/dev/null

mkdir -p slots runtime logs browser_profiles whatsapp_profiles

echo "Node bootstrap complete."
