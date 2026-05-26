@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example
  echo Edit .env and add TELEGRAM_BOT_TOKEN and GROQ_API_KEY, then run this file again.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js LTS first: https://nodejs.org
  pause
  exit /b 1
)
call npm install
call npm run check
call npm start
pause
