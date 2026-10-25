#!/usr/bin/env bash --norc
# Poll codexbar every 5 min. Exit 0 with "CODEX_READY" when Codex session > 0%,
# or "GROK_READY" after 18:20 if Grok weekly > 0%, or keep waiting.
while true; do
  now=$(date +%H%M)
  c=$(codexbar usage --provider codex --no-color 2>/dev/null | sed -n 's/^Session: \([0-9]*\)% left.*/\1/p' | head -1)
  g=$(codexbar usage --provider grok --no-color 2>/dev/null | sed -n 's/^Weekly: \([0-9]*\)% left.*/\1/p' | head -1)
  echo "$(date +%H:%M) codex_session=${c:-?} grok_weekly=${g:-?}"
  if [ -n "$c" ] && [ "$c" -gt 0 ]; then echo CODEX_READY; exit 0; fi
  if [ "$now" -ge 1820 ] && [ -n "$g" ] && [ "$g" -gt 0 ]; then echo GROK_READY; exit 0; fi
  sleep 300
done
