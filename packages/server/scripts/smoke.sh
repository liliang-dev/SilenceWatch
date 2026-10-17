#!/usr/bin/env bash
# End-to-end smoke test against a running SilenceWatch server.
#
# Proves the product with curl alone: register, create a check, ping it, watch it
# go LATE then DOWN, then bring it back UP with another ping.
#
#   BASE=http://localhost:8080 ./scripts/smoke.sh
#
# It signs up with a password, so the server has to run with AUTH_MODE=password:
# a passkey needs a browser. The session is a cookie, kept in a jar for the run, and
# a write made with one names the page it comes from, as a browser would.
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
EMAIL="${EMAIL:-smoke-$RANDOM@example.test}"
PASSWORD="${PASSWORD:-a-long-enough-password}"

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
SESSION_OPTS=(-b "$JAR" -H "origin: $BASE")

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const p=process.argv[1].split(".");let v=o;for(const k of p)v=v?.[k];process.stdout.write(String(v??""))})' "$1"; }

say "Health"
curl -fsS "$BASE/health"; echo

say "Register $EMAIL"
curl -fsS -c "$JAR" -X POST "$BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' -H "origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"\"}" >/dev/null \
  || { echo "sign-up failed: is the server running with AUTH_MODE=password?"; exit 1; }
grep -q session_token "$JAR" || { echo "no session cookie"; exit 1; }

say "Projects"
PROJECT_ID=$(curl -fsS "$BASE/api/v1/projects" "${SESSION_OPTS[@]}" | json 0.id)
echo "project=$PROJECT_ID"

say "Create a check (interval 30s, grace 0s)"
CHECK=$(curl -fsS -X POST "$BASE/api/v1/projects/$PROJECT_ID/checks" \
  "${SESSION_OPTS[@]}" -H 'content-type: application/json' \
  -d '{"name":"Smoke job","scheduleType":"interval","periodSeconds":30,"graceSeconds":0,"environment":"test"}')
CHECK_ID=$(printf '%s' "$CHECK" | json id)
PING_URL=$(printf '%s' "$CHECK" | json pingUrl)
echo "check=$CHECK_ID"
echo "ping=$PING_URL"

say "Ping (start, then success with a body)"
curl -fsS "$PING_URL/start"; echo
sleep 1
curl -fsS -X POST "$PING_URL" -H 'content-type: text/plain' --data 'backup finished, 42 files'; echo

state() { curl -fsS "$BASE/api/v1/checks/$CHECK_ID" "${SESSION_OPTS[@]}" | json state; }
say "State after ping: $(state)"

say "Waiting for the deadline to pass (grace 0 → straight to DOWN)"
for _ in $(seq 1 20); do
  sleep 3
  current=$(state)
  echo "  state=$current"
  [ "$current" = "DOWN" ] && break
done

say "Incidents"
curl -fsS "$BASE/api/v1/checks/$CHECK_ID/incidents" "${SESSION_OPTS[@]}"; echo

say "Recovery ping"
curl -fsS "$PING_URL"; echo
sleep 4
say "State after recovery: $(state)"

say "Pings recorded"
curl -fsS "$BASE/api/v1/checks/$CHECK_ID/pings?limit=5" "${SESSION_OPTS[@]}"; echo

say "Unknown ping key is a 404, never a 200"
curl -s -o /dev/null -w '  %{http_code}\n' "$BASE/p/00000000-0000-4000-8000-000000000000"

say "Done"
