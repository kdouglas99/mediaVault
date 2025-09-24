#!/usr/bin/env bash
set -euo pipefail

# Integration test that brings up docker-compose and verifies DB, backend, and frontend
# Requirements:
# - docker and docker compose available
# - .env file with DB_*, PORT, VITE_API_URL

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "[ERROR] .env file not found in project root. Copy .env.example or create one." >&2
  exit 1
fi

# Load .env into current shell (do not override already exported vars)
# Using POSIX-compatible approach with set -a to auto-export
# shellcheck disable=SC1091
set -a
. ./.env
set +a

DB_CONTAINER_NAME="media-vault-db"
BACKEND_CONTAINER_NAME="media-vault-backend"
FRONTEND_CONTAINER_NAME="media-vault-frontend"
BACKEND_PORT="${PORT:-3001}"
FRONTEND_PORT=3000

cleanup() {
  echo "[INFO] Bringing down docker-compose stack..."
  docker compose down -v || true
}
trap cleanup EXIT

# Build and start
echo "[INFO] Building and starting docker-compose stack..."
docker compose up -d --build

# Helper: wait for container health
wait_for_health() {
  local name=$1
  local timeout=${2:-180}
  local waited=0
  echo "[INFO] Waiting for container '$name' to become healthy (timeout ${timeout}s)..."
  while true; do
    status=$(docker inspect --format='{{json .State.Health.Status}}' "$name" 2>/dev/null | tr -d '"') || status=""
    if [[ "$status" == "healthy" ]]; then
      echo "[INFO] $name is healthy"
      return 0
    fi
    if (( waited >= timeout )); then
      echo "[ERROR] Timeout waiting for $name to be healthy. Current status: ${status:-unknown}" >&2
      echo "[INFO] Container list:"; docker ps || true
      echo "[INFO] === $name docker inspect .State.Health ==="; docker inspect --format='{{json .State.Health}}' "$name" || true
      echo "[INFO] === $name docker inspect .Config.Env ==="; docker inspect --format='{{json .Config.Env}}' "$name" || true
      echo "[INFO] === Last 200 log lines from $name ==="; docker logs --tail=200 "$name" || true
      return 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
}

# 1) Wait for Postgres health
wait_for_health "$DB_CONTAINER_NAME" 240

# 2) Wait for backend HTTP health endpoint
backend_url="http://localhost:${BACKEND_PORT}/health"
echo "[INFO] Waiting for backend at ${backend_url}..."
retries=60
until curl -fsS "$backend_url" | grep -q '"status"\s*:\s*"OK"'; do
  ((retries--)) || { echo "[ERROR] Backend health check failed"; docker logs "$BACKEND_CONTAINER_NAME" || true; exit 1; }
  sleep 2
done

echo "[INFO] Backend health OK"

# 3) Verify DB connectivity via /api/test
api_test_url="http://localhost:${BACKEND_PORT}/api/test"
echo "[INFO] Verifying DB connectivity via ${api_test_url}..."
if ! curl -fsS "$api_test_url" | grep -q '"success"\s*:\s*true'; then
  echo "[ERROR] Backend DB test failed"
  docker logs "$BACKEND_CONTAINER_NAME" || true
  exit 1
fi

echo "[INFO] Backend DB connectivity OK"

# 4) Verify frontend serves content
frontend_url="http://localhost:${FRONTEND_PORT}"
echo "[INFO] Checking frontend at ${frontend_url}..."
if ! curl -fsS "$frontend_url" | grep -Eqi '<!doctype html|<html'; then
  echo "[ERROR] Frontend did not return HTML content"
  docker logs "$FRONTEND_CONTAINER_NAME" || true
  exit 1
fi

echo "[INFO] Frontend responded with HTML"

# 5) Verify frontend can reach backend config (optional)
config_url="${frontend_url}/api/config"
if curl -fsS "$config_url" | grep -q '"success"\s*:\s*true'; then
  echo "[INFO] Frontend config endpoint reachable"
else
  echo "[WARN] Frontend config endpoint not reachable; continuing"
fi

echo "[INFO] All docker-compose integration checks passed."