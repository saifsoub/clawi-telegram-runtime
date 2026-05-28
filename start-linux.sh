#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
  echo "Edit .env and add TELEGRAM_BOT_TOKEN and GROQ_API_KEY, then run this script again."
  exit 1
fi
command -v node >/dev/null || { echo "Node.js is not installed. Install Node.js LTS first."; exit 1; }
npm install
npm run check
npm start
