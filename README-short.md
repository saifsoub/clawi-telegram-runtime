# Clawi Telegram Runtime

## Required

```
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
```

## Optional

```
# Identity
APP_NAME=Clawi Telegram Runtime
OWNER_NAME=Seif Alsoub
OWNER_TELEGRAM_USER_ID=123456789
SEIF_CHAT_ID=123456789

# AI
GROQ_API_KEY=gsk_xxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
STREAMING=true

# Security
PRIVATE_MODE=true
AUTO_PAIR_FIRST_USER=true
ALLOWED_TELEGRAM_USER_IDS=123456789,987654321
ALLOWED_GROUP_IDS=-1001234567890
GROUP_REQUIRE_MENTION=true
GROUP_ACTIVATION_WORDS=clawi

# n8n
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/clawi-task
N8N_MIRROR_WEBHOOK_URL=https://n8n.example.com/webhook/clawi-mirror
N8N_SECRET=change_me

# Deployment
BOT_MODE=polling
PUBLIC_BASE_URL=https://your-app.com
WEBHOOK_SECRET=auto_generated
PORT=8080

# Storage
STORAGE_DIR=./data
MAX_SESSION_HISTORY=18
```

## Quick Start

```bash
npm install
npm start
```

First user to send `/start` in a DM becomes the owner.
