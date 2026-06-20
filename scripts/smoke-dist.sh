#!/usr/bin/env bash
set -u
cd /Users/jangchoi/copilot-hackathon-kit
SHIPSCRIBE_OFFLINE=1 PORT=5200 node dist/server.js > /tmp/shipscribe-dist.log 2>&1 &
PID=$!
sleep 2
echo "== health =="
curl -s --max-time 5 http://127.0.0.1:5200/api/health
echo
echo "== info =="
curl -s --max-time 5 http://127.0.0.1:5200/api/info
echo
echo "== static / =="
curl -s --max-time 5 http://127.0.0.1:5200/ | head -1
echo "== log =="
cat /tmp/shipscribe-dist.log
kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null
echo "== ok =="
