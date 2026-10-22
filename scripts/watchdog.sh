#!/bin/bash
# Watchdog: keeps the SYNKRA Design dev server + realtime service alive.
# The sandbox periodically kills long-running processes; this restarts them.
while true; do
  sleep 30
  # Realtime service (3010)
  if ! ss -tln 2>/dev/null | rg -q ":3010"; then
    (cd /home/z/my-project/mini-services/realtime && nohup bun run index.ts > /tmp/realtime.log 2>&1 &)
    echo "$(date '+%H:%M:%S') restarted realtime" >> /tmp/watchdog.log
  fi
  # Next dev server (3000)
  if ! curl -s -o /dev/null --max-time 5 http://localhost:3000/; then
    pkill -f "next dev" 2>/dev/null
    pkill -f "next-server" 2>/dev/null
    sleep 2
    (cd /home/z/my-project && nohup bun run dev > /dev/null 2>&1 &)
    echo "$(date '+%H:%M:%S') restarted next dev" >> /tmp/watchdog.log
  fi
done
