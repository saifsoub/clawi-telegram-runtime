#!/usr/bin/env bash
# Deploy @clawi_bot on Linux VPS (Docker)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp deploy/.env.vps.example .env
  echo "Created .env — add TELEGRAM_BOT_TOKEN and GROQ_API_KEY, then re-run."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Install Docker first: https://docs.docker.com/engine/install/"
  exit 1
fi

mkdir -p data
docker compose pull 2>/dev/null || true
docker compose build --no-cache
docker compose up -d

echo ""
echo "Waiting for health..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:8080/health" >/dev/null; then
    echo "OK — @clawi_bot runtime is up on :8080"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "Health check failed. Logs:"
docker compose logs --tail=40
exit 1
