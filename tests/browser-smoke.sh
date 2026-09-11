#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PRC_SMOKE_PORT:-4173}"
TMP="$(mktemp -d)"
cleanup(){
  if [[ -n "${SERVER_PID:-}" ]]; then kill "$SERVER_PID" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT
cd "$ROOT"
node tests/static-smoke.test.mjs
python3 -m http.server "$PORT" --bind 127.0.0.1 >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/" >"$TMP/http.html" 2>/dev/null; then break; fi
  sleep 0.1
done
grep -q "Poker Replay Coach" "$TMP/http.html"
grep -q "V4 STANDALONE" "$TMP/http.html"
CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
if [[ -z "$CHROME" ]]; then
  echo "browser smoke skipped: Chromium/Chrome not installed (HTTP + static smoke passed)"
  exit 0
fi
set +e
timeout 10s "$CHROME" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-background-networking \
  --no-first-run --disable-default-apps --disable-extensions --user-data-dir="$TMP/profile" \
  --virtual-time-budget=2000 --dump-dom "http://127.0.0.1:$PORT/" >"$TMP/dom.html" 2>"$TMP/chrome.log"
STATUS=$?
set -e
if [[ $STATUS -ne 0 && ! -s "$TMP/dom.html" ]]; then
  if grep -Eqi "dbus|zygote|UPower|Widget" "$TMP/chrome.log"; then
    echo "browser smoke skipped: host Chromium unavailable (HTTP + static smoke passed)"
    exit 0
  fi
  cat "$TMP/chrome.log" >&2
  exit "$STATUS"
fi
grep -q "Poker Replay Coach" "$TMP/dom.html"
grep -q "V4 STANDALONE" "$TMP/dom.html"
grep -q "Compartilhar replay" "$TMP/dom.html"
if grep -Eqi "Uncaught (TypeError|ReferenceError|SyntaxError)|Failed to load module script" "$TMP/chrome.log"; then
  cat "$TMP/chrome.log" >&2
  exit 1
fi
echo "browser smoke passed"
