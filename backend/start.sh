#!/usr/bin/env bash
# Start historian-api with all required env vars
# Usage: ./start.sh [--reload]
#
# Copy backend/.env.example to backend/.env and fill in your values before running.
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Error: backend/.env not found. Copy .env.example to .env and fill in your values."
  exit 1
fi

set -a
# shellcheck source=/dev/null
source .env
set +a

exec uvicorn historian_api.main:app --host 0.0.0.0 --port "${PORT:-8000}" "$@"
