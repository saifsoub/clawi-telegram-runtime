# APEX OpenClaw-Style Telegram Runtime — One-File Edition

This package turns your uploaded APEX bot fragments into one Telegram-ready runtime.

## What is inside

- `apex-openclaw-telegram.js` — the full one-file bot/runtime
- `.env.example` — copy to `.env` and add keys
- `start-windows.bat` — easiest Windows start
- `start-linux.sh` — easiest Linux/VPS start
- `docker-compose.yml` — simple VPS/container deployment
- `n8n-apex-router.workflow.json` — optional n8n import for triggering the bot from n8n

## Minimum setup

1. Create a Telegram bot with BotFather and copy the token.
2. Get a Groq API key.
3. Rename/copy `.env.example` to `.env`.
4. Fill:

```env
TELEGRAM_BOT_TOKEN=...
GROQ_API_KEY=...
INTERNAL_API_SECRET=change_this
```

5. Start:

### Windows

Double-click:

```txt
start-windows.bat
```

### Linux / DigitalOcean / Hostinger VPS

```bash
chmod +x start-linux.sh
./start-linux.sh
```

### Docker

```bash
docker compose up -d --build
```

## First Telegram activation

By default:

```env
PRIVATE_MODE=true
AUTO_PAIR_FIRST_USER=true
```

So the first person who sends `/start` to the bot becomes the owner. For better long-term safety, send `/whoami`, copy your User ID, then add it to `.env`:

```env
OWNER_TELEGRAM_USER_ID=123456789
SEIF_CHAT_ID=123456789
AUTO_PAIR_FIRST_USER=false
```

Restart the bot.

## Key Telegram commands

```txt
/start
/status
/whoami
/help
/remember [text]
/memory
/todo [task]
/todos
/social
/scan
/market
/approvals
/wallet
/handoff [task]
```

S/ skills:

```txt
/synthesize [topic]
/gov [context]
/kpi [objective]
/evidence [claim]
/boardroom [topic]
/critique [proposal]
/secretary [task]
```

## n8n bridge

The bot exposes:

```txt
POST /n8n/telegram/send
POST /n8n/task
POST /api/chat
POST /api/approval/create
POST /api/approval/respond
GET  /health
```

All protected endpoints require:

```txt
x-secret: your_INTERNAL_API_SECRET
```

Example:

```bash
curl -X POST http://localhost:8080/n8n/telegram/send \
  -H "Content-Type: application/json" \
  -H "x-secret: change_this" \
  -d '{"text":"Hello from n8n"}'
```

## OpenClaw/TeleClaw-style features included

- Telegram DMs and groups
- Private mode, allowlist, first-owner pairing
- Mention-based group activation
- Session isolation per DM/group/topic
- Live preview edits while the model responds
- Memory per chat + global memory
- Notes and task tracking
- S/ specialist skill routing
- Social content options + approval cards
- Market signal scanning
- n8n/MCP-style webhook handoff
- Media/document capture from Telegram
- Wallet-safe TON placeholder with approval gate

## Important safety notes

- Do not put private wallet keys in `.env`.
- `/wallet` is intentionally safe/read-only unless you wire an external wallet workflow.
- Publishing, money, wallet actions, external sending, and client commitments should stay approval-gated.
- Keep `PRIVATE_MODE=true` if the bot has sensitive memory or business context.
