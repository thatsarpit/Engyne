#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LAUNCH_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"

for plist in org.engyne.node-api.plist org.engyne.dispatchers.plist; do
  src="$ROOT_DIR/config/launchd/$plist"
  dest="$LAUNCH_DIR/$plist"
  sed "s|__ROOT_DIR__|$ROOT_DIR|g" "$src" > "$dest"
  launchctl unload "$dest" >/dev/null 2>&1 || true
  launchctl load "$dest"
  echo "Loaded $plist"
done

echo "LaunchAgents installed. Use: launchctl list | rg engyne"
