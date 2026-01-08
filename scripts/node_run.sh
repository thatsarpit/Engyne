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
export NODE_ID=${NODE_ID:-"node-1"}

API_HOST=${API_HOST:-"0.0.0.0"}
API_PORT=${API_PORT:-"8001"}

uvicorn engyne_api.main:app --host "$API_HOST" --port "$API_PORT"
