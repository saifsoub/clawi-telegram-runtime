# Clawi Telegram bot — plain-language README

## What this is
The code for Clawi (@clawi_bot), a Telegram chat bot that runs around the clock on a rented server. It chats using Groq's fast AI service, remembers things, keeps to-do lists and can pass bigger jobs on to Seif's other AI helpers.

## Who it's for
Seif, the bot's owner, who talks to it from Telegram.

## What it does today
- Answers messages in Telegram, even when Seif's laptop is off.
- Commands:
  - `/status`: is it running?
  - `/todo`: to-do list
  - `/memory`: what it remembers
  - `/social`: social posts
  - `/help`
  - `/handoff [task]`: pass a job on. The job is sent to an n8n automation, saved in a Supabase database queue, and Telegram confirms it was received.
- Has a health check at `http://127.0.0.1:8080/health` on the server.
- This is not the Cursor code-editor bot, and it does not edit code on your laptop.

## How to run it
On an Ubuntu 22 or newer server:
```bash
git clone https://github.com/saifsoub/clawi-telegram-runtime.git
cd clawi-telegram-runtime
cp deploy/.env.vps.example .env
# In .env, set TELEGRAM_BOT_TOKEN, GROQ_API_KEY and OWNER_TELEGRAM_USER_ID
chmod +x deploy/deploy-vps.sh
./deploy/deploy-vps.sh
```
Then in Telegram:
1. Send `/start`, then `/whoami`.
2. Put the ID it shows into `OWNER_TELEGRAM_USER_ID` and `SEIF_CHAT_ID`.
3. Set `AUTO_PAIR_FIRST_USER=false` and restart.
4. Set `N8N_WEBHOOK_URL` to the automation that receives handed-off jobs.

The repo also has `docker-compose.yml`, `render.yaml` and `vercel.json` for other hosting options, plus `start-linux.sh` and `start-windows.bat` for local runs.

## Current status and known gaps
- Never commit `.env`. If keys were ever synced through OneDrive, replace them with new ones.
- Set `PRIVATE_MODE=true` when using it for business.
- Whether the live bot is up right now: not yet confirmed.
- The repo also holds several landing pages, a zipped website and other experiments. Which ones are current is not yet confirmed.

## Where things live
| File / folder | What's in it |
|---|---|
| `clawi-telegram-runtime.js` | The main bot |
| `apex-openclaw-telegram.js` | An earlier, larger version of the bot |
| `deploy/`, `clawi-deploy/` | Server setup scripts |
| `skills/` | Extra abilities the bot can use |
| `public/`, `clawi-landing.html`, `clawi_landing.html` | Web pages |
| `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md` | The bot's personality, owner details and tool notes |
| `n8n-apex-router.workflow.json`, `s-agentos-command-gateway-v0.2.0-rc1.json` | Automations to import into n8n |
