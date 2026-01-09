#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-}"
if [[ -z "$ENV_FILE" ]]; then
  if [[ -f "$ROOT_DIR/.env.node" ]]; then
    ENV_FILE="$ROOT_DIR/.env.node"
  elif [[ -f "$ROOT_DIR/.env" ]]; then
    ENV_FILE="$ROOT_DIR/.env"
  fi
fi
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:-1}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:-1}"
    fi
    export "$key"="$value"
  done < "$ENV_FILE"
fi

PYTHON_BIN="${PYTHON_BIN:-python3.13}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python3"
fi
if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
source .venv/bin/activate
pip install -r api/requirements.txt >/dev/null

export PYTHONPATH="$ROOT_DIR/api:$ROOT_DIR"
export SLOTS_ROOT=${SLOTS_ROOT:-"$ROOT_DIR/slots"}
export NODE_ID=${NODE_ID:-"node-1"}

API_HOST=${API_HOST:-"0.0.0.0"}
API_PORT=${API_PORT:-"8001"}

uvicorn engyne_api.main:app --host "$API_HOST" --port "$API_PORT"
