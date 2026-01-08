#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PORTS_TO_FREE=(8001 5173)
PID_GLOB="$ROOT_DIR/runtime/*.pid"
VNC_PORT_RANGE="5900-5999"

log() { printf "%s\n" "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
Usage: scripts/kill_all.sh [--dry-run] [--force]

Stops ENGYNE-related local processes and frees dev ports.

Actions (idempotent):
  - Kills anything LISTENing on ports 8001 (API) and 5173 (Dashboard)
  - Kills processes whose command line contains the repo root path
  - Kills Playwright/Chromium processes only when they reference this repo's profiles
  - Removes stale PID files: runtime/*.pid

Flags:
  --dry-run  Print actions without killing anything.
  --force    Escalate to SIGKILL after SIGTERM.
EOF
}

DRY_RUN=0
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) log "Unknown arg: $1"; usage; exit 2 ;;
  esac
  shift
done

kill_pid() {
  local pid="$1"
  local sig="${2:-TERM}"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] kill -$sig $pid"
    return 0
  fi
  kill "-$sig" "$pid" 2>/dev/null || true
}

wait_gone() {
  local pid="$1"
  local max_ms="${2:-1500}"
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [[ "$waited" -ge "$max_ms" ]]; then
      return 1
    fi
    sleep 0.1
    waited=$((waited + 100))
  done
  return 0
}

kill_pid_gracefully() {
  local pid="$1"
  kill_pid "$pid" TERM
  if wait_gone "$pid" 2000; then
    return 0
  fi
  if [[ "$FORCE" -eq 1 ]]; then
    kill_pid "$pid" KILL
    wait_gone "$pid" 2000 || true
  fi
}

cmdline_for_pid() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null || true
}

pids_listening_on_port() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' | xargs -n1 2>/dev/null || true
}

rm_pid_files() {
  shopt -s nullglob
  local pid_files=($PID_GLOB)
  if [[ "${#pid_files[@]}" -eq 0 ]]; then
    return 0
  fi
  for f in "${pid_files[@]}"; do
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "[dry-run] rm -f $f"
    else
      rm -f "$f" || true
    fi
  done
}

log "ENGYNE pre-flight cleanup"
log "- repo: $ROOT_DIR"
log "- dry-run: $DRY_RUN, force: $FORCE"

log ""
log "1) Freeing ports: ${PORTS_TO_FREE[*]}"
for port in "${PORTS_TO_FREE[@]}"; do
  pids="$(pids_listening_on_port "$port" | tr '\n' ' ' | xargs 2>/dev/null || true)"
  if [[ -z "${pids// }" ]]; then
    log "  - port $port: already free"
    continue
  fi
  for pid in $pids; do
    local_cmd="$(cmdline_for_pid "$pid")"
    log "  - port $port: stopping pid $pid: $local_cmd"
    kill_pid_gracefully "$pid"
  done
done

log ""
log "1b) Checking VNC-related listeners (ports $VNC_PORT_RANGE)"
vnc_pids="$(lsof -nP -iTCP:"$VNC_PORT_RANGE" -sTCP:LISTEN -t 2>/dev/null | sort -u | xargs 2>/dev/null || true)"
if [[ -z "${vnc_pids// }" ]]; then
  log "  - none listening on $VNC_PORT_RANGE"
else
  for pid in $vnc_pids; do
    if [[ "$pid" -eq "$$" || "$pid" -eq "$PPID" ]]; then
      continue
    fi
    cmd="$(cmdline_for_pid "$pid")"
    case "$cmd" in
      *"$ROOT_DIR"*|*engyne*|*Engyne*)
        log "  - stopping VNC listener pid $pid: $cmd"
        kill_pid_gracefully "$pid"
        ;;
      *)
        log "  - leaving non-Engyne VNC listener pid $pid: $cmd"
        ;;
    esac
  done
fi

log ""
log "2) Killing repo-root processes (command line contains repo path)"
root_pids="$(
  ps -ax -o pid=,command= \
    | grep -iF "$ROOT_DIR" \
    | grep -v -E 'kill_all\.sh|grep -iF' \
    | awk '{print $1}' \
    | sort -u \
    | xargs 2>/dev/null || true
)"
if [[ -z "${root_pids// }" ]]; then
  log "  - none found"
else
  for pid in $root_pids; do
    if [[ "$pid" -eq "$$" || "$pid" -eq "$PPID" ]]; then
      continue
    fi
    cmd="$(cmdline_for_pid "$pid")"
    log "  - stopping pid $pid: $cmd"
    kill_pid_gracefully "$pid"
  done
fi

log ""
log "3) Killing Playwright/Chromium processes only for this repo"
pw_pids="$(ps -ax -o pid=,command= | grep -E -i 'playwright|ms-playwright|chromium' | awk '{print $1}' | sort -u | xargs 2>/dev/null || true)"
if [[ -z "${pw_pids// }" ]]; then
  log "  - none found"
else
  for pid in $pw_pids; do
    if [[ "$pid" -eq "$$" || "$pid" -eq "$PPID" ]]; then
      continue
    fi
    cmd="$(cmdline_for_pid "$pid")"
    case "$cmd" in
      *"$ROOT_DIR/browser_profiles/"*|*"$ROOT_DIR/whatsapp_profiles/"*|*"$ROOT_DIR/slots/"*|*"$ROOT_DIR"/*playwright*)
        log "  - stopping pid $pid: $cmd"
        kill_pid_gracefully "$pid"
        ;;
      *)
        ;;
    esac
  done
fi

log ""
log "4) Removing stale PID files (runtime/*.pid)"
mkdir -p "$ROOT_DIR/runtime"
rm_pid_files

log ""
log "5) Verification"
for port in "${PORTS_TO_FREE[@]}"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    log "  - port $port: STILL LISTENING (re-run with --force and inspect lsof)"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  else
    log "  - port $port: free"
  fi
done

if lsof -nP -iTCP:"$VNC_PORT_RANGE" -sTCP:LISTEN >/dev/null 2>&1; then
  log "  - VNC listeners ($VNC_PORT_RANGE): present (non-Engyne listeners may remain)"
  lsof -nP -iTCP:"$VNC_PORT_RANGE" -sTCP:LISTEN 2>/dev/null || true
else
  log "  - VNC listeners ($VNC_PORT_RANGE): none"
fi

if ps -ax -o pid=,command= \
  | grep -iF "$ROOT_DIR" \
  | grep -v -E 'kill_all\.sh|grep -iF' \
  >/dev/null 2>&1; then
  log "  - repo-root processes: STILL RUNNING"
  ps -ax -o pid=,command= \
    | grep -iF "$ROOT_DIR" \
    | grep -v -E 'kill_all\.sh|grep -iF' || true
else
  log "  - repo-root processes: none"
fi

log ""
log "Done."
