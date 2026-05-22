#!/usr/bin/env node
/*
  Clawi Telegram Runtime v1 — single-file edition
  Owner: Seif Alsoub

  What this file provides:
  - Telegram DM + group bot with allowlist / first-owner pairing
  - Memory (session + global), notes, todos, approvals
  - n8n-friendly HTTP endpoints for automation
  - Groq LLM integration with streaming
  - Media/file capture and local storage
  - Security gates: approval-required for money, publishing, external sending, deleting, wallet movement

  Safety note:
  - Never hardcode API keys. Use .env.
  - Keep PRIVATE_MODE=true for sensitive use.
  - This bot will not sign transactions or handle private keys.
*/

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const Groq = require("groq-sdk");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function list(value) {
  if (!value) return [];
  return String(value).split(",").map((v) => v.trim()).filter(Boolean);
}

function safeInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const CONFIG = {
  appName: process.env.APP_NAME || "Clawi Telegram Runtime",
  port: safeInt(process.env.PORT, 8080),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  mode: (process.env.BOT_MODE || "polling").toLowerCase(), // polling | webhook
  webhookSecret: process.env.WEBHOOK_SECRET || crypto.randomBytes(12).toString("hex"),

  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  streaming: bool(process.env.STREAMING, true),

  ownerName: process.env.OWNER_NAME || "Seif Alsoub",
  ownerTelegramUserId: process.env.OWNER_TELEGRAM_USER_ID || process.env.SEIF_CHAT_ID || "",
  ownerChatId: process.env.SEIF_CHAT_ID || process.env.OWNER_TELEGRAM_USER_ID || "",

  privateMode: bool(process.env.PRIVATE_MODE, true),
  autoPairFirstUser: bool(process.env.AUTO_PAIR_FIRST_USER, true),
  allowedUserIds: list(process.env.ALLOWED_TELEGRAM_USER_IDS || process.env.ALLOW_FROM),
  allowedGroupIds: list(process.env.ALLOWED_GROUP_IDS),
  groupAllowUserIds: list(process.env.GROUP_ALLOWED_USER_IDS),
  groupRequireMention: bool(process.env.GROUP_REQUIRE_MENTION, true),
  groupActivationWords: list(process.env.GROUP_ACTIVATION_WORDS || "clawi"),

  internalApiSecret: process.env.INTERNAL_API_SECRET || process.env.N8N_SECRET || "clawi_change_me",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || "",
  n8nMirrorWebhookUrl: process.env.N8N_MIRROR_WEBHOOK_URL || "",

  storageDir: process.env.STORAGE_DIR || path.join(process.cwd(), "data"),
  maxHistory: safeInt(process.env.MAX_SESSION_HISTORY, 18),
  maxTelegramChars: 3900,
};

if (!CONFIG.telegramToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Add it to .env first.");
  process.exit(1);
}

const groq = CONFIG.groqApiKey ? new Groq({ apiKey: CONFIG.groqApiKey }) : null;

// ---------------------------------------------------------------------------
// Storage — JSON backed for easy deployment
// ---------------------------------------------------------------------------
const DATA_DIR = CONFIG.storageDir;
const MEDIA_DIR = path.join(DATA_DIR, "media");
const STORE_FILE = path.join(DATA_DIR, "clawi-store.json");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DATA_DIR);
ensureDir(MEDIA_DIR);

const DEFAULT_STORE = {
  version: "1.0.0",
  owner: null,
  sessions: {},
  globalMemory: [],
  notes: [],
  todos: [],
  approvals: {},
  assets: [],
  logs: [],
};

let STORE_CACHE = null;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadStore() {
  if (STORE_CACHE) return STORE_CACHE;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    STORE_CACHE = { ...clone(DEFAULT_STORE), ...parsed };
  } catch {
    STORE_CACHE = clone(DEFAULT_STORE);
  }
  return STORE_CACHE;
}

function saveStore() {
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(loadStore(), null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function logEvent(action, details = {}) {
  const store = loadStore();
  store.logs.push({ id: crypto.randomUUID(), ts: new Date().toISOString(), action, details });
  if (store.logs.length > 1000) store.logs = store.logs.slice(-1000);
  saveStore();
}

function sanitizeFilename(name) {
  return String(name || "asset")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 64) || "asset";
}

// ---------------------------------------------------------------------------
// Telegram runtime
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.static(path.join(__dirname, "public")));

const botOptions = CONFIG.mode === "polling"
  ? { polling: { interval: 500, autoStart: true, params: { timeout: 30 } } }
  : { polling: false };

const bot = new TelegramBot(CONFIG.telegramToken, botOptions);
let BOT_USERNAME = "";

function userIdOf(msg) { return msg?.from?.id ? String(msg.from.id) : ""; }
function chatIdOf(msg) { return msg?.chat?.id ? String(msg.chat.id) : ""; }
function chatTypeOf(msg) { return msg?.chat?.type || "private"; }
function threadIdOf(msg) { return msg?.message_thread_id ? String(msg.message_thread_id) : "main"; }

function sessionKey(msg) {
  const chatId = chatIdOf(msg);
  const thread = threadIdOf(msg);
  if (chatTypeOf(msg) === "private") return `dm:${userIdOf(msg)}`;
  return `group:${chatId}:topic:${thread}`;
}

function getSession(msg) {
  const key = sessionKey(msg);
  const store = loadStore();
  if (!store.sessions[key]) {
    store.sessions[key] = {
      key,
      chatId: chatIdOf(msg),
      chatType: chatTypeOf(msg),
      threadId: threadIdOf(msg),
      title: msg.chat?.title || msg.chat?.username || msg.from?.username || CONFIG.ownerName,
      activation: chatTypeOf(msg) === "private" ? "always" : (CONFIG.groupRequireMention ? "mention" : "always"),
      memory: [],
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveStore();
  }
  return store.sessions[key];
}

function isConfiguredOwner(msg) {
  const uid = userIdOf(msg);
  const cid = chatIdOf(msg);
  const ids = new Set([CONFIG.ownerTelegramUserId, CONFIG.ownerChatId, ...CONFIG.allowedUserIds].filter(Boolean).map(String));
  return ids.has(uid) || ids.has(cid);
}

function isStoredOwner(msg) {
  const store = loadStore();
  if (!store.owner) return false;
  return String(store.owner.userId) === userIdOf(msg);
}

function canAutoPair(msg, text) {
  const store = loadStore();
  return CONFIG.autoPairFirstUser && !store.owner && chatTypeOf(msg) === "private" && /^\/start\b/i.test(text || "");
}

function pairFirstOwner(msg) {
  const store = loadStore();
  store.owner = {
    userId: userIdOf(msg),
    chatId: chatIdOf(msg),
    username: msg.from?.username || "",
    firstName: msg.from?.first_name || "",
    pairedAt: new Date().toISOString(),
    method: "auto_pair_first_user",
  };
  saveStore();
  logEvent("owner_paired", store.owner);
}

function isGroupAllowed(msg) {
  const groupIds = CONFIG.allowedGroupIds;
  if (!groupIds.length) return !CONFIG.privateMode;
  if (groupIds.includes("*")) return true;
  return groupIds.includes(chatIdOf(msg));
}

function isGroupSenderAllowed(msg) {
  const ids = CONFIG.groupAllowUserIds.length ? CONFIG.groupAllowUserIds : [CONFIG.ownerTelegramUserId, ...CONFIG.allowedUserIds].filter(Boolean);
  if (!ids.length) return isStoredOwner(msg) || isConfiguredOwner(msg);
  if (ids.includes("*")) return true;
  return ids.map(String).includes(userIdOf(msg));
}

function textMentionsBot(text = "") {
  const lowered = text.toLowerCase();
  if (BOT_USERNAME && lowered.includes(`@${BOT_USERNAME.toLowerCase()}`)) return true;
  return CONFIG.groupActivationWords.some((w) => lowered.includes(w.toLowerCase()));
}

function shouldProcessMessage(msg, text) {
  if (canAutoPair(msg, text)) {
    pairFirstOwner(msg);
    return { ok: true };
  }
  if (chatTypeOf(msg) === "private") {
    if (!CONFIG.privateMode) return { ok: true };
    if (isStoredOwner(msg) || isConfiguredOwner(msg)) return { ok: true };
    return { ok: false, reason: "private_allowlist" };
  }
  if (!isGroupAllowed(msg)) return { ok: false, reason: "group_not_allowed" };
  if (!isGroupSenderAllowed(msg)) return { ok: false, reason: "group_sender_not_allowed" };
  const session = getSession(msg);
  if (session.activation === "always") return { ok: true };
  if (textMentionsBot(text)) return { ok: true };
  if (/^\/\w+/.test(text || "")) return { ok: true };
  return { ok: false, reason: "mention_required" };
}

async function safeSend(chatId, text, opts = {}) {
  const chunks = splitText(text, CONFIG.maxTelegramChars);
  let last;
  for (const chunk of chunks) {
    last = await bot.sendMessage(chatId, chunk, opts).catch(async (e) => {
      if (opts.parse_mode) return bot.sendMessage(chatId, chunk, { ...opts, parse_mode: undefined });
      throw e;
    });
  }
  return last;
}

async function safeEdit(chatId, messageId, text, opts = {}) {
  const chunks = splitText(text, CONFIG.maxTelegramChars);
  const first = chunks.shift() || "Done.";
  try {
    await bot.editMessageText(first, { chat_id: chatId, message_id: messageId, ...opts });
  } catch (e) {
    try { await bot.sendMessage(chatId, first, opts); } catch {}
  }
  for (const extra of chunks) await safeSend(chatId, extra, opts);
}

function splitText(text, max = 3900) {
  const s = String(text || "");
  if (s.length <= max) return [s];
  const chunks = [];
  let rest = s;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function mirrorToN8n(eventName, payload) {
  if (!CONFIG.n8nMirrorWebhookUrl) return;
  try {
    await axios.post(CONFIG.n8nMirrorWebhookUrl, { event: eventName, payload }, { timeout: 12000 });
  } catch (e) {
    logEvent("n8n_mirror_failed", { eventName, error: e.message });
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const CLAWI_SYSTEM = `You are Clawi — Seif Alsoub's practical AI builder and operator.
You build Telegram bots, Telegram mini apps, n8n workflows, web apps, and automation panels.
You deploy end-to-end. You do not do shallow demos.

Your deployment hierarchy: Kimi Claw cloud → Cloudflare Workers → Vercel → n8n → Supabase → GitHub → VPS (last resort only).

Rules:
- Build first. Explain only after.
- Ask for approval only for: money, publishing, external sending, deleting, wallet actions, or commitments on Seif's behalf.
- Operational drafting and internal analysis can proceed without approval.
- No filler. No over-explaining. Produce usable outputs.
- When uncertain, inspect first, then act.
- If a tool is missing, propose the closest working alternative.`;

function stripCommand(text = "") {
  return text.replace(/^\/\w+(?:@\w+)?\s*/i, "").trim();
}

function buildSystemPrompt(msg) {
  const store = loadStore();
  const session = getSession(msg);
  const globalMemory = store.globalMemory.slice(-12).map((m) => `- ${m.text}`).join("\n");
  const sessionMemory = session.memory.slice(-12).map((m) => `- ${m.text}`).join("\n");
  return `${CLAWI_SYSTEM}\n\nGlobal memory:\n${globalMemory || "- None yet."}\n\nThis chat memory:\n${sessionMemory || "- None yet."}`;
}

async function askGroq({ msg, text, previewMessage }) {
  if (!groq) {
    return "GROQ_API_KEY is not configured yet. Add it to .env, restart, then I can answer with the model.";
  }
  const session = getSession(msg);
  const system = buildSystemPrompt(msg);
  const cleanText = stripCommand(text) || text;
  const history = session.history.slice(-CONFIG.maxHistory).map((h) => ({ role: h.role, content: h.content }));
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: cleanText }];

  if (!CONFIG.streaming || !previewMessage) {
    const completion = await groq.chat.completions.create({
      model: CONFIG.model, messages, temperature: 0.45, max_tokens: 1800,
    });
    return completion.choices?.[0]?.message?.content || "No response generated.";
  }

  const stream = await groq.chat.completions.create({
    model: CONFIG.model, messages, temperature: 0.45, max_tokens: 1800, stream: true,
  });

  let content = "";
  let lastEdit = 0;
  for await (const part of stream) {
    const delta = part.choices?.[0]?.delta?.content || "";
    content += delta;
    const now = Date.now();
    if (content && now - lastEdit > 1800 && content.length < CONFIG.maxTelegramChars) {
      lastEdit = now;
      await safeEdit(chatIdOf(msg), previewMessage.message_id, content + "\n\n…", {});
    }
  }
  return content || "No response generated.";
}

function pushHistory(msg, role, content) {
  const session = getSession(msg);
  session.history.push({ role, content: String(content || "").slice(0, 5000), ts: new Date().toISOString() });
  session.history = session.history.slice(-CONFIG.maxHistory * 2);
  session.updatedAt = new Date().toISOString();
  saveStore();
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
function createApproval({ type, title, content, payload = {}, source = "telegram", chatId = CONFIG.ownerChatId }) {
  const id = `appr_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const store = loadStore();
  store.approvals[id] = { id, type, title, content, payload, source, chatId, status: "pending", createdAt: new Date().toISOString(), resolvedAt: null };
  saveStore();
  return store.approvals[id];
}

async function sendApprovalCard(chatId, approval) {
  const text = `Approval required\n\nID: ${approval.id}\nType: ${approval.type}\n${approval.title}\n\n${approval.content}`;
  return bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: [[{ text: "Approve", callback_data: `approve:${approval.id}` }, { text: "Reject", callback_data: `reject:${approval.id}` }]] },
  });
}

function resolveApproval(id, status) {
  const store = loadStore();
  const approval = store.approvals[id];
  if (!approval) return null;
  approval.status = status;
  approval.resolvedAt = new Date().toISOString();
  saveStore();
  logEvent("approval_resolved", { id, status });
  return approval;
}

function listPendingApprovals() {
  return Object.values(loadStore().approvals).filter((a) => a.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Notes, tasks, memory
// ---------------------------------------------------------------------------
function addMemory(msg, text, scope = "session") {
  const item = { id: crypto.randomUUID(), text: text.trim(), ts: new Date().toISOString(), scope };
  const store = loadStore();
  if (scope === "global") store.globalMemory.push(item);
  else getSession(msg).memory.push(item);
  saveStore();
  return item;
}

function showMemory(msg) {
  const session = getSession(msg);
  const store = loadStore();
  const global = store.globalMemory.slice(-20).map((m, i) => `${i + 1}. ${m.text}`).join("\n");
  const local = session.memory.slice(-20).map((m, i) => `${i + 1}. ${m.text}`).join("\n");
  return `Memory\n\nGlobal:\n${global || "None yet."}\n\nThis chat:\n${local || "None yet."}`;
}

function addNote(text) {
  const store = loadStore();
  const note = { id: `note_${Date.now()}`, text: text.trim(), ts: new Date().toISOString() };
  store.notes.push(note);
  saveStore();
  return note;
}

function addTodo(text) {
  const store = loadStore();
  const todo = { id: `todo_${Date.now()}`, text: text.trim(), done: false, ts: new Date().toISOString() };
  store.todos.push(todo);
  saveStore();
  return todo;
}

// ---------------------------------------------------------------------------
// Media handling
// ---------------------------------------------------------------------------
async function downloadTelegramFile(fileId, filenameHint = "file") {
  const file = await bot.getFile(fileId);
  const ext = path.extname(file.file_path || "") || path.extname(filenameHint) || ".bin";
  const filename = `${Date.now()}_${sanitizeFilename(filenameHint)}${ext}`;
  const localPath = path.join(MEDIA_DIR, filename);
  const url = `https://api.telegram.org/file/bot${CONFIG.telegramToken}/${file.file_path}`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  fs.writeFileSync(localPath, Buffer.from(res.data));
  return { localPath, filename, size: fs.statSync(localPath).size, telegramPath: file.file_path };
}

async function handleMedia(msg) {
  const chatId = chatIdOf(msg);
  try {
    let fileId = null;
    let filename = "telegram_media";
    let mediaType = "media";
    if (msg.document) { fileId = msg.document.file_id; filename = msg.document.file_name || "document"; mediaType = "document"; }
    else if (msg.photo?.length) { fileId = msg.photo[msg.photo.length - 1].file_id; filename = "photo.jpg"; mediaType = "photo"; }
    else if (msg.voice) { fileId = msg.voice.file_id; filename = "voice.ogg"; mediaType = "voice"; }
    else if (msg.video) { fileId = msg.video.file_id; filename = msg.video.file_name || "video.mp4"; mediaType = "video"; }
    if (!fileId) return false;
    const saved = await downloadTelegramFile(fileId, filename);
    const store = loadStore();
    store.assets.push({ id: crypto.randomUUID(), mediaType, ...saved, caption: msg.caption || "", ts: new Date().toISOString() });
    saveStore();
    await safeSend(chatId, `Received ${mediaType}. Saved locally:\n${saved.localPath}\n\nSend a caption or command if you want me to use it.`);
    return true;
  } catch (e) {
    await safeSend(chatId, `I received the file, but saving failed: ${e.message}`);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function helpText() {
  return `Clawi Telegram Runtime

Core
/start — initialize
/status — system health
/whoami — show Telegram IDs
/help — this list

Memory + Work
/remember [text] — remember in this chat
/memory — show memory
/note [text] — save note
/notes — list notes
/todo [text] — add task
/todos — list tasks
/done [todo_id] — mark task complete

Build Commands
/build_bot [description] — generate a Telegram bot
/build_app [description] — generate a Telegram mini app
/make_n8n_workflow [description] — generate n8n workflow JSON

Controls
/approval [description] — create an approval card
/approvals — list pending approvals
/approve [id] — approve an item
/reject [id] — reject an item
/handoff [text] — send task to n8n webhook

Send any normal message to chat with Clawi.`;
}

async function handleCommand(msg, text) {
  const chatId = chatIdOf(msg);
  const lower = text.toLowerCase().trim();

  if (/^\/start\b/.test(lower)) {
    return safeSend(chatId, `Clawi is online for ${CONFIG.ownerName}.\n\n${helpText()}`);
  }

  if (/^\/help\b/.test(lower)) return safeSend(chatId, helpText());

  if (/^\/whoami\b/.test(lower)) {
    return safeSend(chatId, `Telegram IDs\n\nUser ID: ${userIdOf(msg)}\nChat ID: ${chatIdOf(msg)}\nChat type: ${chatTypeOf(msg)}\nThread ID: ${threadIdOf(msg)}\nBot: @${BOT_USERNAME || "unknown"}`);
  }

  if (/^\/status\b/.test(lower)) {
    const store = loadStore();
    return safeSend(chatId, `Status: online\nOwner: ${CONFIG.ownerName}\nBot: @${BOT_USERNAME || "unknown"}\nModel: ${CONFIG.groqApiKey ? CONFIG.model : "not configured"}\nMode: ${CONFIG.mode}\nPrivate mode: ${CONFIG.privateMode}\nOwner paired: ${store.owner ? "yes" : "no"}\nSessions: ${Object.keys(store.sessions).length}\nPending approvals: ${listPendingApprovals().length}\nStorage: ${DATA_DIR}`);
  }

  if (/^\/remember\b/.test(lower)) {
    const memory = stripCommand(text);
    if (!memory) return safeSend(chatId, "Send /remember followed by what to remember.");
    addMemory(msg, memory, "session");
    return safeSend(chatId, "Saved to this chat memory.");
  }

  if (/^\/memory\b/.test(lower)) return safeSend(chatId, showMemory(msg));

  if (/^\/note\b/.test(lower)) {
    const t = stripCommand(text);
    if (!t) return safeSend(chatId, "Send /note followed by the note.");
    const note = addNote(t);
    return safeSend(chatId, `Note saved: ${note.id}`);
  }

  if (/^\/notes\b/.test(lower)) {
    const notes = loadStore().notes.slice(-20);
    return safeSend(chatId, notes.length ? notes.map((n) => `${n.id}: ${n.text}`).join("\n") : "No notes yet.");
  }

  if (/^\/todo\b/.test(lower)) {
    const t = stripCommand(text);
    if (!t) return safeSend(chatId, "Send /todo followed by the task.");
    const todo = addTodo(t);
    return safeSend(chatId, `Task added: ${todo.id}`);
  }

  if (/^\/todos\b/.test(lower)) {
    const todos = loadStore().todos.slice(-30);
    return safeSend(chatId, todos.length ? todos.map((t) => `${t.done ? "✓" : "□"} ${t.id}: ${t.text}`).join("\n") : "No tasks yet.");
  }

  if (/^\/done\b/.test(lower)) {
    const id = stripCommand(text);
    const store = loadStore();
    const todo = store.todos.find((t) => t.id === id || t.id.endsWith(id));
    if (!todo) return safeSend(chatId, "Task not found.");
    todo.done = true;
    todo.doneAt = new Date().toISOString();
    saveStore();
    return safeSend(chatId, `Done: ${todo.text}`);
  }

  // Build commands
  if (/^\/build_bot\b/.test(lower)) {
    const desc = stripCommand(text);
    if (!desc) return safeSend(chatId, "Send /build_bot followed by a description of the bot you want.");
    if (!groq) return safeSend(chatId, "GROQ_API_KEY not configured. Add it to .env and restart.");
    const preview = await bot.sendMessage(chatId, "Building bot…");
    const prompt = `Build a complete, working Telegram bot based on this request: "${desc}".\n\nReturn ONLY the complete Node.js code using node-telegram-bot-api. Include all handlers, inline keyboards where useful, and a concise comment header. No explanations outside the code. The bot should be immediately runnable with a TELEGRAM_BOT_TOKEN env var.`;
    const reply = await askGroq({ msg, text: prompt, previewMessage: preview });
    pushHistory(msg, "user", text);
    pushHistory(msg, "assistant", reply);
    await safeEdit(chatId, preview.message_id, `Bot code ready.\n\n${reply.slice(0, 2000)}${reply.length > 2000 ? "\n\n[truncated — full code in response above]" : ""}\n\n— Clawi`);
    return;
  }

  if (/^\/build_app\b/.test(lower)) {
    const desc = stripCommand(text);
    if (!desc) return safeSend(chatId, "Send /build_app followed by a description of the mini app you want.");
    if (!groq) return safeSend(chatId, "GROQ_API_KEY not configured. Add it to .env and restart.");
    const preview = await bot.sendMessage(chatId, "Building mini app…");
    const prompt = `Build a complete Telegram Mini App based on this request: "${desc}".\n\nReturn a single HTML file with embedded CSS and JS. Use the Telegram Web App API (Telegram.WebApp). Mobile-first, clean UI. Include a manifest.json description. No explanations outside the code.`;
    const reply = await askGroq({ msg, text: prompt, previewMessage: preview });
    pushHistory(msg, "user", text);
    pushHistory(msg, "assistant", reply);
    await safeEdit(chatId, preview.message_id, `Mini app code ready.\n\n${reply.slice(0, 2000)}${reply.length > 2000 ? "\n\n[truncated — full code in response above]" : ""}\n\n— Clawi`);
    return;
  }

  if (/^\/make_n8n_workflow\b/.test(lower)) {
    const desc = stripCommand(text);
    if (!desc) return safeSend(chatId, "Send /make_n8n_workflow followed by a description of the workflow you want.");
    if (!groq) return safeSend(chatId, "GROQ_API_KEY not configured. Add it to .env and restart.");
    const preview = await bot.sendMessage(chatId, "Building n8n workflow…");
    const prompt = `Build a complete n8n workflow JSON based on this request: "${desc}".\n\nReturn ONLY valid n8n workflow JSON. Include triggers, nodes, connections, and parameters. The workflow must be importable via n8n's Settings > Export/Import. No explanations outside the JSON.`;
    const reply = await askGroq({ msg, text: prompt, previewMessage: preview });
    pushHistory(msg, "user", text);
    pushHistory(msg, "assistant", reply);
    await safeEdit(chatId, preview.message_id, `Workflow JSON ready.\n\n${reply.slice(0, 2000)}${reply.length > 2000 ? "\n\n[truncated — full JSON in response above]" : ""}\n\n— Clawi`);
    return;
  }

  // Approval commands
  if (/^\/approval\b/.test(lower)) {
    const desc = stripCommand(text);
    if (!desc) return safeSend(chatId, "Send /approval followed by a description of what needs approval.");
    const approval = createApproval({ type: "general", title: desc, content: desc, chatId });
    await sendApprovalCard(chatId, approval);
    return;
  }

  if (/^\/approvals\b/.test(lower)) {
    const pending = listPendingApprovals();
    return safeSend(chatId, pending.length ? pending.map((a) => `${a.id}\n${a.type}: ${a.title}\nCreated: ${a.createdAt}`).join("\n\n") : "No pending approvals.");
  }

  if (/^\/approve\b/.test(lower) || /^\/reject\b/.test(lower)) {
    const id = stripCommand(text);
    if (!id) return safeSend(chatId, "Send /approve [id] or /reject [id].");
    const status = lower.startsWith("/approve") ? "approved" : "rejected";
    const approval = resolveApproval(id, status);
    if (!approval) return safeSend(chatId, "Approval not found.");
    return safeSend(chatId, `${status}: ${approval.title}`);
  }

  if (/^\/handoff\b/.test(lower)) {
    const task = stripCommand(text);
    if (!CONFIG.n8nWebhookUrl) return safeSend(chatId, "N8N_WEBHOOK_URL is not configured in .env.");
    if (!task) return safeSend(chatId, "Send /handoff followed by the task.");
    const res = await axios.post(CONFIG.n8nWebhookUrl, { source: "telegram", from: userIdOf(msg), chatId, task }, { timeout: 20000 }).catch((e) => ({ error: e }));
    if (res.error) return safeSend(chatId, `n8n handoff failed: ${res.error.message}`);
    return safeSend(chatId, "Sent to n8n.");
  }

  return false;
}

async function handleNormalMessage(msg, text) {
  const chatId = chatIdOf(msg);
  const preview = await bot.sendMessage(chatId, "Clawi is preparing…");
  const reply = await askGroq({ msg, text, previewMessage: preview });
  pushHistory(msg, "user", text);
  pushHistory(msg, "assistant", reply);
  await safeEdit(chatId, preview.message_id, `${reply}\n\n— Clawi`);
}

bot.on("message", async (msg) => {
  const text = msg.text || msg.caption || "";
  const chatId = chatIdOf(msg);

  try {
    const gate = shouldProcessMessage(msg, text);
    if (!gate.ok) {
      if (chatTypeOf(msg) === "private") {
        await safeSend(chatId, `Private bot. Access not enabled.\n\nSend /whoami to see your Telegram ID, then add it to OWNER_TELEGRAM_USER_ID or ALLOWED_TELEGRAM_USER_IDS.`).catch(() => {});
      }
      logEvent("message_ignored", { reason: gate.reason, chatId, userId: userIdOf(msg), text: text.slice(0, 80) });
      return;
    }

    await mirrorToN8n("telegram_message", { chatId, userId: userIdOf(msg), text, chatType: chatTypeOf(msg) });

    if (!text && (msg.document || msg.photo || msg.voice || msg.video)) {
      await handleMedia(msg);
      return;
    }

    if (text.startsWith("/")) {
      const handled = await handleCommand(msg, text);
      if (handled !== false) return;
    }

    if (msg.document || msg.photo || msg.voice || msg.video) {
      await handleMedia(msg);
      if (!text) return;
    }

    await handleNormalMessage(msg, text);
  } catch (e) {
    logEvent("message_error", { error: e.message, stack: e.stack?.slice(0, 2000) });
    await safeSend(chatId, `Something went wrong: ${e.message}`);
  }
});

bot.on("callback_query", async (query) => {
  try {
    const data = query.data || "";
    const chatId = String(query.message.chat.id);
    if (data.startsWith("approve:")) {
      const id = data.split(":")[1];
      const approval = resolveApproval(id, "approved");
      await bot.answerCallbackQuery(query.id, { text: approval ? "Approved" : "Not found" });
      if (approval) await safeSend(chatId, `Approved: ${approval.title}`);
      return;
    }
    if (data.startsWith("reject:")) {
      const id = data.split(":")[1];
      const approval = resolveApproval(id, "rejected");
      await bot.answerCallbackQuery(query.id, { text: approval ? "Rejected" : "Not found" });
      if (approval) await safeSend(chatId, `Rejected: ${approval.title}`);
      return;
    }
    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    logEvent("callback_error", { error: e.message });
  }
});

bot.on("polling_error", (err) => logEvent("polling_error", { message: err.message }));

// ---------------------------------------------------------------------------
// HTTP / n8n endpoints
// ---------------------------------------------------------------------------
function requireSecret(req, res, next) {
  const provided = req.headers["x-secret"] || req.query.secret || req.body?.secret;
  if (String(provided || "") !== String(CONFIG.internalApiSecret)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

app.get("/health", (req, res) => {
  const store = loadStore();
  res.json({
    ok: true,
    app: CONFIG.appName,
    owner: CONFIG.ownerName,
    bot: BOT_USERNAME,
    mode: CONFIG.mode,
    modelConfigured: Boolean(CONFIG.groqApiKey),
    ownerPaired: Boolean(store.owner),
    sessions: Object.keys(store.sessions).length,
    approvals: listPendingApprovals().length,
    storageDir: DATA_DIR,
    ts: new Date().toISOString(),
  });
});
app.get("/api/health", (req, res) => res.redirect("/health"));

app.post("/api/chat", requireSecret, async (req, res) => {
  try {
    if (!groq) return res.status(400).json({ ok: false, error: "GROQ_API_KEY not configured" });
    const message = req.body.message || req.body.text || (Array.isArray(req.body.messages) ? req.body.messages.map((m) => m.content).join("\n") : "");
    const completion = await groq.chat.completions.create({
      model: CONFIG.model,
      messages: [{ role: "system", content: CLAWI_SYSTEM }, { role: "user", content: message }],
      temperature: 0.45,
      max_tokens: 1600,
    });
    const reply = completion.choices?.[0]?.message?.content || "";
    res.json({ ok: true, reply, content: reply });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/n8n/telegram/send", requireSecret, async (req, res) => {
  try {
    const chatId = String(req.body.chatId || CONFIG.ownerChatId || loadStore().owner?.chatId || "");
    const text = req.body.text || req.body.message || "";
    if (!chatId || !text) return res.status(400).json({ ok: false, error: "chatId and text required" });
    await safeSend(chatId, text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/n8n/task", requireSecret, async (req, res) => {
  try {
    const action = req.body.action || "send";
    const chatId = String(req.body.chatId || CONFIG.ownerChatId || loadStore().owner?.chatId || "");
    if (action === "approval") {
      const approval = createApproval({ type: req.body.type || "general", title: req.body.title || "Approval requested", content: req.body.content || "", payload: req.body.payload || {}, chatId });
      if (chatId) await sendApprovalCard(chatId, approval);
      return res.json({ ok: true, approval });
    }
    res.json({ ok: true, message: "No action executed", action });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/approval/create", requireSecret, async (req, res) => {
  const approval = createApproval({
    type: req.body.type || "general",
    title: req.body.title || "Approval requested",
    content: req.body.content || "",
    payload: req.body.payload || {},
    chatId: String(req.body.chatId || CONFIG.ownerChatId || loadStore().owner?.chatId || ""),
  });
  if (approval.chatId) await sendApprovalCard(approval.chatId, approval).catch(() => {});
  res.json({ ok: true, approval });
});

app.post("/api/approval/respond", requireSecret, (req, res) => {
  const approval = resolveApproval(req.body.id, req.body.status === "approved" ? "approved" : "rejected");
  if (!approval) return res.status(404).json({ ok: false, error: "Approval not found" });
  res.json({ ok: true, approval });
});

app.post("/api/booking", async (req, res) => {
  const { name, email, phone, date, time, notes } = req.body || {};
  if (!name || !email || !phone || !date || !time) return res.status(400).json({ ok: false, error: "Missing required fields" });
  const id = `booking_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const note = addNote(`Booking ${id}: ${name}, ${email}, ${phone}, ${date} ${time}. ${notes || ""}`);
  const chatId = CONFIG.ownerChatId || loadStore().owner?.chatId;
  if (chatId) await safeSend(chatId, `New booking\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nDate: ${date}\nTime: ${time}\nNotes: ${notes || "None"}`).catch(() => {});
  res.json({ ok: true, id, noteId: note.id });
});

if (CONFIG.mode === "webhook") {
  app.post(`/telegram/${CONFIG.webhookSecret}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  const me = await bot.getMe();
  BOT_USERNAME = me.username || "";

  if (CONFIG.mode === "webhook") {
    if (!CONFIG.publicBaseUrl) {
      console.warn("BOT_MODE=webhook requires PUBLIC_BASE_URL. Webhook not set; HTTP route is still available.");
    } else {
      const webhookUrl = `${CONFIG.publicBaseUrl.replace(/\/$/, "")}/telegram/${CONFIG.webhookSecret}`;
      await bot.setWebHook(webhookUrl);
      console.log(`Webhook set: ${webhookUrl}`);
    }
  }

  app.listen(CONFIG.port, () => {
    console.log(`${CONFIG.appName} running on port ${CONFIG.port}`);
    console.log(`Telegram bot: @${BOT_USERNAME}`);
    console.log(`Mode: ${CONFIG.mode}`);
    console.log(`Health: http://localhost:${CONFIG.port}/health`);
    if (!CONFIG.groqApiKey) console.warn("GROQ_API_KEY missing: AI replies will not work.");
    if (!CONFIG.ownerTelegramUserId && CONFIG.autoPairFirstUser) console.warn("AUTO_PAIR_FIRST_USER=true: first /start DM becomes owner.");
  });
}

start().catch((e) => {
  console.error("Startup failed:", e);
  process.exit(1);
});
