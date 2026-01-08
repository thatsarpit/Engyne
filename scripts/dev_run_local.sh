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
export SLOTS_ROOT=${SLOTS_ROOT:-"$ROOT_DIR/slots"}

uvicorn engyne_api.main:app --host 127.0.0.1 --port 8001

