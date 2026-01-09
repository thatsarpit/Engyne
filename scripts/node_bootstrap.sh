#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.node}"
if [[ ! -f "$ENV_FILE" && -f "$ROOT_DIR/deploy/env.node.example" ]]; then
  cp "$ROOT_DIR/deploy/env.node.example" "$ENV_FILE"
  echo "Wrote $ENV_FILE. Edit it before starting the node."
fi

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" - <<'PY'
import sys
sys.exit(0 if sys.version_info >= (3, 11) else 1)
PY
      then
        PYTHON_BIN="$candidate"
        break
      fi
    fi
  done
fi
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3.11+ required. Install python3.11 and retry."
  exit 1
fi

if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
source .venv/bin/activate
pip install -r api/requirements.txt >/dev/null

mkdir -p slots runtime logs browser_profiles whatsapp_profiles

echo "Node bootstrap complete."
