#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_GEOMETRY="${SCREEN_GEOMETRY:-1920x1080x24}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
export GOOGLE_AUTH_BROWSER_CHANNEL="${GOOGLE_AUTH_BROWSER_CHANNEL:-chromium}"

XVFB_PID=""
FLUXBOX_PID=""
X11VNC_PID=""
NOVNC_PID=""

cleanup() {
  for pid in "$NOVNC_PID" "$X11VNC_PID" "$FLUXBOX_PID" "$XVFB_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

mkdir -p /tmp/.X11-unix

Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" &
XVFB_PID=$!

export DISPLAY

fluxbox >/tmp/fluxbox.log 2>&1 &
FLUXBOX_PID=$!

x11vnc \
  -display "$DISPLAY" \
  -forever \
  -shared \
  -localhost \
  -nopw \
  -rfbport "$VNC_PORT" \
  >/tmp/x11vnc.log 2>&1 &
X11VNC_PID=$!

/usr/share/novnc/utils/novnc_proxy \
  --vnc "127.0.0.1:${VNC_PORT}" \
  --listen "$NOVNC_PORT" \
  >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

echo "noVNC available inside container on http://127.0.0.1:${NOVNC_PORT}/vnc.html"
echo "Starting manual Google auth bootstrap with persistent Chrome profile..."

exec pnpm auth:bootstrap:prod
