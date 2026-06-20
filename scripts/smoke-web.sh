#!/usr/bin/env bash
set -u
cd /Users/jangchoi/copilot-hackathon-kit
SHIPSCRIBE_OFFLINE=1 PORT=5199 SHIPSCRIBE_REPO="$PWD" npx tsx src/server.ts > /tmp/shipscribe-web.log 2>&1 &
SERVER_PID=$!
sleep 3
echo "== GET /api/health =="
curl -s --max-time 5 http://127.0.0.1:5199/api/health
echo
echo "== GET /api/info =="
curl -s --max-time 5 http://127.0.0.1:5199/api/info
echo
echo "== POST /api/release (SSE, first 45 lines) =="
curl -s --max-time 10 -X POST http://127.0.0.1:5199/api/release -H 'Content-Type: application/json' -d '{"range":"v0.1.0..HEAD"}' | head -45
echo
echo "== GET / (index.html first line) =="
curl -s --max-time 5 http://127.0.0.1:5199/ | head -1
echo
echo "== server stderr/stdout log =="
cat /tmp/shipscribe-web.log
kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
echo "== done =="
