# @clawi_bot — Telegram runtime (24/7)

Production Telegram bot for **Clawi** — Groq + memory + `/handoff` to the agent runtime.  
**Not** Cursor IDE remote (`@cursor_mini_bot`). **Not** repo editing on your laptop.

Canonical source was consolidated from `apex-openclaw-telegram-onefile` (May 2026).

## Three-lane map

| Lane | When laptop is off | What it does |
|------|-------------------|--------------|
| **This repo (VPS)** | Yes | @clawi_bot answers, todos, skills, `/handoff` |
| **Cursor Cloud** | Yes | SDK cloud agent on GitHub repos |
| **Agent runtime queue** | Yes (ack + store) | n8n + Supabase queue; laptop/cloud pickup |

Full wiring: see [S-OS](https://github.com/saifsoub/S-OS).

## VPS deploy (quick)

```bash
# On VPS (Ubuntu 22+)
git clone https://github.com/saifsoub/clawi-telegram-runtime.git
cd clawi-telegram-runtime
cp deploy/.env.vps.example .env
# Edit .env — TELEGRAM_BOT_TOKEN (@clawi_bot), GROQ_API_KEY, OWNER_TELEGRAM_USER_ID
chmod +x deploy/deploy-vps.sh
./deploy/deploy-vps.sh
```

Health: `curl -s http://127.0.0.1:8080/health`

## Telegram setup

1. BotFather token for **@clawi_bot** → `TELEGRAM_BOT_TOKEN`
2. `/start` once, then `/whoami` → set `OWNER_TELEGRAM_USER_ID` + `SEIF_CHAT_ID`
3. Set `AUTO_PAIR_FIRST_USER=false`, restart
4. Point `N8N_WEBHOOK_URL` at the agent runtime queue (see THREE_LANES.md)

## Key commands

`/status` `/handoff [task]` `/todo` `/memory` `/social` `/help`

Handoff payload → n8n `POST /webhook/s-agentos-telegram-queue` → Supabase `queued` → Telegram ack.

## Security

- Never commit `.env`
- Rotate tokens if synced via OneDrive
- `PRIVATE_MODE=true` for business context
