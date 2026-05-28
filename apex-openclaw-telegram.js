#!/usr/bin/env node
/*
  APEX OpenClaw-Style Telegram Runtime — single-file edition
  Owner: Seif Alsoub

  What this file provides:
  - Telegram DM + group bot with allowlist / first-owner pairing
  - OpenClaw-style sessions, memory, skills, live preview edits, media capture
  - S/ specialist skills, content generation, approval cards, market signals
  - n8n-friendly HTTP endpoints for simple automation
  - Wallet-safe TON placeholder: read-only / approval-gated, no private-key handling

  Safety note:
  - Never hardcode API keys in this file. Use .env.
  - Public bots can be prompt-injected. Keep PRIVATE_MODE=true for sensitive use.
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

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------
function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function list(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function safeInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const CONFIG = {
  appName: process.env.APP_NAME || "APEX Telegram Runtime",
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
  groupActivationWords: list(process.env.GROUP_ACTIVATION_WORDS || "apex,sally,clawi"),

  internalApiSecret: process.env.INTERNAL_API_SECRET || process.env.N8N_SECRET || "apex_change_me",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || "",
  n8nMirrorWebhookUrl: process.env.N8N_MIRROR_WEBHOOK_URL || "",

  storageDir: process.env.STORAGE_DIR || path.join(process.cwd(), "data"),
  maxHistory: safeInt(process.env.MAX_SESSION_HISTORY, 18),
  maxTelegramChars: 3900,

  marketCronEnabled: bool(process.env.ENABLE_MARKET_CRON, false),
  marketCron: process.env.MARKET_CRON || "0 8,18 * * *",

  tonWalletAddress: process.env.TON_WALLET_ADDRESS || "",
  tonWalletWebhookUrl: process.env.TON_WALLET_WEBHOOK_URL || "",
};

if (!CONFIG.telegramToken) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Add it to .env first.");
  process.exit(1);
}

const groq = CONFIG.groqApiKey ? new Groq({ apiKey: CONFIG.groqApiKey }) : null;

// -----------------------------------------------------------------------------
// Storage — JSON backed for easy one-click deployment
// -----------------------------------------------------------------------------
const DATA_DIR = CONFIG.storageDir;
const ASSET_DIR = path.join(DATA_DIR, "assets");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const STORE_FILE = path.join(DATA_DIR, "apex-store.json");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DATA_DIR);
ensureDir(ASSET_DIR);
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
  market: {
    sourceState: {},
    signals: [],
    competitorSignals: [],
    tenders: [],
    funding: [],
    watchlist: [],
  },
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
  store.logs.push({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    action,
    details,
  });
  if (store.logs.length > 1000) store.logs = store.logs.slice(-1000);
  saveStore();
}

function dayFolder(base = ASSET_DIR) {
  const d = new Date().toISOString().slice(0, 10);
  const folder = path.join(base, d);
  ensureDir(folder);
  ensureDir(path.join(folder, "visuals"));
  ensureDir(path.join(folder, "copy"));
  ensureDir(path.join(folder, "approval"));
  return folder;
}

function sanitizeFilename(name) {
  return String(name || "asset")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 64) || "asset";
}

// -----------------------------------------------------------------------------
// Telegram runtime
// -----------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));

const botOptions = CONFIG.mode === "polling"
  ? { polling: { interval: 500, autoStart: true, params: { timeout: 30 } } }
  : { polling: false };

const bot = new TelegramBot(CONFIG.telegramToken, botOptions);
let BOT_USERNAME = "";

function userIdOf(msg) {
  return msg?.from?.id ? String(msg.from.id) : "";
}

function chatIdOf(msg) {
  return msg?.chat?.id ? String(msg.chat.id) : "";
}

function chatTypeOf(msg) {
  return msg?.chat?.type || "private";
}

function threadIdOf(msg) {
  return msg?.message_thread_id ? String(msg.message_thread_id) : "main";
}

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
  const ids = new Set([
    CONFIG.ownerTelegramUserId,
    CONFIG.ownerChatId,
    ...CONFIG.allowedUserIds,
  ].filter(Boolean).map(String));
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
  const type = chatTypeOf(msg);
  if (canAutoPair(msg, text)) {
    pairFirstOwner(msg);
    return { ok: true };
  }

  if (type === "private") {
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

// -----------------------------------------------------------------------------
// S/ specialist skill prompts
// -----------------------------------------------------------------------------
const S_BASE_SYSTEM = `You are APEX, Seif Alsoub's practical Telegram executive assistant.
Operate in S/ AI Empowered style: concise, strategic, useful, warm, and decision-ready.
You help with strategy, KPIs, government excellence, AI transformation, content, execution, and daily operations.
Do not claim actions were sent, paid, published, transferred, or committed unless a tool actually did it.
Approval rule: money, publishing, external sending, wallet actions, and client commitments require approval. Operational drafting and internal analysis can proceed.
Avoid generic filler. Produce usable outputs.`;

const S_AGENTS = {
  SYNTHESIST: {
    name: "Synthesist",
    commands: ["/synthesize"],
    keywords: ["framework", "matrix", "model", "structure"],
    prompt: `You are the Synthesist for S/ AI Empowered.
Compress complex strategic thinking into one practical framework.
Preferred outputs: 2x2 matrix, pyramid logic, cascade map, MECE tree, comparison axis.
Every element must change the decision outcome.`,
  },
  GOV_ARCHITECT: {
    name: "Government Excellence Architect",
    commands: ["/gov"],
    keywords: ["uae", "gcc", "government", "excellence", "award", "institution"],
    prompt: `You are the Government Excellence Architect.
Translate national strategy, government excellence, service design, and institutional maturity into practical operating blueprints.
Use credible government-grade logic and avoid generic public-sector language.`,
  },
  KPI_ENGINE: {
    name: "KPI & Strategic Alignment Engine",
    commands: ["/kpi", "/performance"],
    keywords: ["kpi", "metric", "performance", "scorecard", "okr"],
    prompt: `You are the KPI & Strategic Alignment Engine.
Cascade objectives into measurable outcomes. Each KPI needs owner, baseline, target, frequency, data source, and causal link. Flag vanity metrics.`,
  },
  EVIDENCE_MAPPER: {
    name: "Institutional Evidence Mapper",
    commands: ["/evidence"],
    keywords: ["evidence", "impact", "audit", "proof", "attribution"],
    prompt: `You are the Institutional Evidence Mapper.
Build traceable evidence chains from decision to outcome. Separate causation, contribution, and correlation clearly.`,
  },
  BOARDROOM_DESIGNER: {
    name: "Boardroom Presentation Designer",
    commands: ["/boardroom"],
    keywords: ["presentation", "deck", "executive", "board", "slide"],
    prompt: `You are the Boardroom Presentation Designer.
Engineer executive narratives where the recommendation is clear from page one. Use pyramid logic, sharp message hierarchy, and decision-ready structure.`,
  },
  CRITIC: {
    name: "Strategic Critic",
    commands: ["/critique", "/review"],
    keywords: ["critique", "review", "challenge", "weakness", "improve"],
    prompt: `You are the Strategic Critic.
Pressure-test assumptions constructively. Surface gaps, risks, weak evidence, and practical improvements without harsh wording.`,
  },
  SECRETARY: {
    name: "Sally Secretary",
    commands: ["/secretary", "/sally"],
    keywords: ["schedule", "reply", "draft", "summarize", "remind"],
    prompt: `You are Sally, Seif's respectful Telegram secretary.
Be warm, concise, protective of attention, and practical. Ask approval only for money, publishing, external sending, wallet actions, or commitments.`,
  },
};

function skillForText(text = "") {
  const lower = text.toLowerCase();
  for (const agent of Object.values(S_AGENTS)) {
    if (agent.commands.some((c) => lower.startsWith(c))) return agent;
  }
  for (const agent of Object.values(S_AGENTS)) {
    if (agent.keywords.some((k) => lower.includes(k))) return agent;
  }
  return null;
}

function stripCommand(text = "") {
  return text.replace(/^\/\w+(?:@\w+)?\s*/i, "").trim();
}

function buildSystemPrompt(msg, selectedAgent = null) {
  const store = loadStore();
  const session = getSession(msg);
  const globalMemory = store.globalMemory.slice(-12).map((m) => `- ${m.text}`).join("\n");
  const sessionMemory = session.memory.slice(-12).map((m) => `- ${m.text}`).join("\n");
  return `${S_BASE_SYSTEM}\n\nActive specialist: ${selectedAgent ? selectedAgent.name : "General Executive Assistant"}\n${selectedAgent ? selectedAgent.prompt : ""}\n\nGlobal memory:\n${globalMemory || "- None yet."}\n\nThis chat memory:\n${sessionMemory || "- None yet."}`;
}

async function askGroq({ msg, text, selectedAgent, previewMessage }) {
  if (!groq) {
    return "GROQ_API_KEY is not configured yet. Add it to .env, restart, then I can answer with the model.";
  }
  const session = getSession(msg);
  const system = buildSystemPrompt(msg, selectedAgent);
  const cleanText = stripCommand(text) || text;
  const history = session.history.slice(-CONFIG.maxHistory).map((h) => ({ role: h.role, content: h.content }));
  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: cleanText },
  ];

  if (!CONFIG.streaming || !previewMessage) {
    const completion = await groq.chat.completions.create({
      model: CONFIG.model,
      messages,
      temperature: 0.45,
      max_tokens: 1800,
    });
    return completion.choices?.[0]?.message?.content || "No response generated.";
  }

  const stream = await groq.chat.completions.create({
    model: CONFIG.model,
    messages,
    temperature: 0.45,
    max_tokens: 1800,
    stream: true,
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

// -----------------------------------------------------------------------------
// Approvals
// -----------------------------------------------------------------------------
function createApproval({ type, title, content, payload = {}, source = "telegram", chatId = CONFIG.ownerChatId }) {
  const id = `appr_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const store = loadStore();
  store.approvals[id] = {
    id,
    type,
    title,
    content,
    payload,
    source,
    chatId,
    status: "pending",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  saveStore();
  return store.approvals[id];
}

async function sendApprovalCard(chatId, approval) {
  const text = `Approval required\n\nID: ${approval.id}\nType: ${approval.type}\n${approval.title}\n\n${approval.content}`;
  return bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [[
        { text: "Approve", callback_data: `approve:${approval.id}` },
        { text: "Reject", callback_data: `reject:${approval.id}` },
      ]],
    },
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

// -----------------------------------------------------------------------------
// Notes, tasks, memory
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Media handling
// -----------------------------------------------------------------------------
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
    if (msg.document) {
      fileId = msg.document.file_id;
      filename = msg.document.file_name || "document";
      mediaType = "document";
    } else if (msg.photo?.length) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      filename = "photo.jpg";
      mediaType = "photo";
    } else if (msg.voice) {
      fileId = msg.voice.file_id;
      filename = "voice.ogg";
      mediaType = "voice";
    } else if (msg.video) {
      fileId = msg.video.file_id;
      filename = msg.video.file_name || "video.mp4";
      mediaType = "video";
    }
    if (!fileId) return false;
    const saved = await downloadTelegramFile(fileId, filename);
    const store = loadStore();
    store.assets.push({ id: crypto.randomUUID(), mediaType, ...saved, caption: msg.caption || "", ts: new Date().toISOString() });
    saveStore();
    await safeSend(chatId, `Received ${mediaType}. Saved locally:\n${saved.localPath}\n\nSend a caption or command if you want me to summarize/use it.`);
    return true;
  } catch (e) {
    await safeSend(chatId, `I received the file, but saving failed: ${e.message}`);
    return true;
  }
}

// -----------------------------------------------------------------------------
// Social/content workflow
// -----------------------------------------------------------------------------
const BRAND = {
  name: "S/ AI Empowered",
  colors: {
    background: "#1A1A1A",
    headline: "#C9A96E",
    body: "#C0C8D8",
    accent: "#FF6B35",
  },
};

async function discoverTrends() {
  if (!groq) throw new Error("GROQ_API_KEY is missing.");
  const prompt = `Identify 3 fresh, credible topics for an executive LinkedIn/X/Instagram content cycle about government AI, institutional performance, digital transformation, or service excellence in the UAE/GCC. Return strict JSON: {"trends":[{"title":"...","why_matters":"...","angle":"..."}]}`;
  const completion = await groq.chat.completions.create({
    model: CONFIG.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.35,
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
  return parsed.trends || [];
}

async function generatePlatformCopy(topic, platform) {
  if (!groq) throw new Error("GROQ_API_KEY is missing.");
  const platformRules = {
    linkedin: "Executive LinkedIn post, 900-1400 characters, practical insight, 3 hashtags maximum.",
    x: "Sharp X post under 270 characters, strong idea, 1-2 hashtags.",
    instagram: "Premium Instagram caption, concise, elegant, 5 hashtags maximum.",
  };
  const completion = await groq.chat.completions.create({
    model: CONFIG.model,
    messages: [
      { role: "system", content: `${S_BASE_SYSTEM}\nWrite in S/ AI Empowered style. No filler. No unsupported statistics.` },
      { role: "user", content: `${platformRules[platform]}\nTopic: ${topic.title}\nWhy it matters: ${topic.why_matters}\nAngle: ${topic.angle || "executive practical insight"}` },
    ],
    temperature: 0.45,
    max_tokens: 700,
  });
  return completion.choices?.[0]?.message?.content || "";
}

function createSvgVisual(topic, index) {
  const folder = dayFolder();
  const safeTitle = String(topic.title || "S/ Signal").replace(/[<>&]/g, "");
  const safeWhy = String(topic.why_matters || "Executive signal").replace(/[<>&]/g, "");
  const file = path.join(folder, "visuals", `topic_${index}_${sanitizeFilename(topic.title)}.svg`);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1A1A1A"/>
      <stop offset="1" stop-color="#26221B"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <rect x="70" y="110" width="6" height="1130" fill="#FF6B35" opacity="0.95"/>
  <text x="105" y="150" font-family="Montserrat, Arial" font-size="24" fill="#C0C8D8" letter-spacing="6">${BRAND.name}</text>
  <text x="105" y="275" font-family="Georgia, serif" font-size="64" fill="#C9A96E" font-weight="700">
    <tspan x="105" dy="0">${safeTitle.slice(0, 28)}</tspan>
    <tspan x="105" dy="78">${safeTitle.slice(28, 56)}</tspan>
    <tspan x="105" dy="78">${safeTitle.slice(56, 84)}</tspan>
  </text>
  <rect x="105" y="590" width="805" height="1" fill="#C9A96E" opacity="0.45"/>
  <text x="105" y="665" font-family="Montserrat, Arial" font-size="34" fill="#C0C8D8">
    <tspan x="105" dy="0">${safeWhy.slice(0, 42)}</tspan>
    <tspan x="105" dy="52">${safeWhy.slice(42, 84)}</tspan>
    <tspan x="105" dy="52">${safeWhy.slice(84, 126)}</tspan>
  </text>
  <circle cx="875" cy="1110" r="88" fill="none" stroke="#C9A96E" stroke-width="2" opacity="0.5"/>
  <text x="835" y="1130" font-family="Georgia, serif" font-size="54" fill="#C9A96E">S/</text>
  <text x="105" y="1230" font-family="Montserrat, Arial" font-size="24" fill="#FF6B35" letter-spacing="4">EXECUTIVE SIGNAL ${String(index).padStart(2, "0")}</text>
</svg>`;
  fs.writeFileSync(file, svg, "utf8");
  return file;
}

async function processSocialTopic(topic, index) {
  const [linkedin, x, instagram] = await Promise.all([
    generatePlatformCopy(topic, "linkedin"),
    generatePlatformCopy(topic, "x"),
    generatePlatformCopy(topic, "instagram"),
  ]);
  const folder = dayFolder();
  const visual = createSvgVisual(topic, index);
  const copyFolder = path.join(folder, "copy");
  const base = `topic_${index}_${sanitizeFilename(topic.title)}`;
  const files = {
    linkedin: path.join(copyFolder, `${base}_linkedin.txt`),
    x: path.join(copyFolder, `${base}_x.txt`),
    instagram: path.join(copyFolder, `${base}_instagram.txt`),
  };
  fs.writeFileSync(files.linkedin, linkedin, "utf8");
  fs.writeFileSync(files.x, x, "utf8");
  fs.writeFileSync(files.instagram, instagram, "utf8");
  return { index, title: topic.title, why_matters: topic.why_matters, angle: topic.angle, linkedin, x, instagram, visual, files, folder };
}

async function runSocialWorkflow(chatId) {
  const status = await bot.sendMessage(chatId, "Preparing today’s content options…");
  const trends = await discoverTrends();
  if (!trends.length) throw new Error("No trends returned.");
  const results = [];
  for (let i = 0; i < trends.length; i++) {
    await safeEdit(chatId, status.message_id, `Preparing topic ${i + 1}/3: ${trends[i].title}`);
    results.push(await processSocialTopic(trends[i], i + 1));
  }
  const summary = results.map((r) => `${r.index}. ${r.title}\n   ${r.why_matters}`).join("\n\n");
  await safeEdit(chatId, status.message_id, `Content ready.\n\n${summary}\n\nAssets folder:\n${results[0].folder}`);
  for (const r of results) {
    const approval = createApproval({
      type: "publishing",
      title: `Publish topic ${r.index}: ${r.title}`,
      content: `LinkedIn/X/Instagram copy and visual are ready. Approve only when you want this moved to publishing/scheduling.`,
      payload: { topic: r.title, folder: r.folder, files: r.files, visual: r.visual },
      chatId,
    });
    await bot.sendDocument(chatId, r.visual, { caption: `Topic ${r.index}: ${r.title}` }).catch(() => {});
    await sendApprovalCard(chatId, approval);
  }
}

// -----------------------------------------------------------------------------
// Market intelligence — lightweight, no Puppeteer required
// -----------------------------------------------------------------------------
const MARKET_SOURCES = [
  { id: "tdra", name: "TDRA", url: "https://tdra.gov.ae/en/media-center/news", keywords: ["AI", "digital", "automation", "smart government", "data", "cloud", "regulation"] },
  { id: "mohre", name: "MOHRE", url: "https://www.mohre.gov.ae/en/media-centre/news.aspx", keywords: ["AI", "automation", "digital transformation", "workforce", "smart services"] },
  { id: "fta", name: "Federal Tax Authority", url: "https://tax.gov.ae/en/news", keywords: ["digital", "e-services", "AI", "automation", "system"] },
  { id: "digital_dubai", name: "Digital Dubai", url: "https://www.digitaldubai.ae/newsroom", keywords: ["AI", "smart city", "digital transformation", "data", "government services"] },
  { id: "wam", name: "WAM", url: "https://www.wam.ae/en/search?q=artificial+intelligence+government", keywords: ["AI", "government", "digital", "smart", "technology", "automation", "strategy"] },
  { id: "the_national", name: "The National Technology", url: "https://www.thenationalnews.com/business/technology/", keywords: ["AI", "government", "digital", "UAE tech", "automation", "GovTech"] },
];

const COMPETITORS = [
  { id: "g42", name: "G42", website: "https://g42.ai", tags: ["ai", "cloud", "government"] },
  { id: "presight", name: "Presight", website: "https://presight.ai", tags: ["ai", "analytics", "government"] },
  { id: "injazat", name: "Injazat", website: "https://www.injazat.com", tags: ["cloud", "ai", "digital transformation"] },
  { id: "dxwand", name: "DXwand", website: "https://dxwand.com", tags: ["conversational ai", "government"] },
];

function classifySignal(text) {
  const lower = text.toLowerCase();
  if (/\b(regulation|policy|circular|law|decree|mandate)\b/.test(lower)) return "POLICY_CHANGE";
  if (/\b(tender|rfp|procurement|bid|contract)\b/.test(lower)) return "TENDER_NOTICE";
  if (/\b(launch|initiative|program|platform|pilot)\b/.test(lower)) return "AI_INITIATIVE";
  if (/\b(partner|mou|agreement|collaboration)\b/.test(lower)) return "PARTNERSHIP";
  if (/\b(budget|invest|fund|billion|million)\b/.test(lower)) return "BUDGET_ALLOCATION";
  return "GENERAL_UPDATE";
}

function relevanceScore(text, keywords) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of ["ai", "artificial intelligence", "govtech", "automation", "digital transformation", "zero bureaucracy"]) {
    if (lower.includes(term)) score += 3;
  }
  for (const kw of keywords || []) if (lower.includes(kw.toLowerCase())) score += 1;
  for (const term of ["uae", "emirates", "dubai", "abu dhabi", "federal"]) {
    if (lower.includes(term)) { score += 1; break; }
  }
  return Math.min(10, score);
}

function extractCandidates(html, sourceUrl) {
  const candidates = new Map();
  const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1];
  if (title) candidates.set(title.replace(/\s+/g, " ").trim(), sourceUrl);

  const regexes = [
    /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis,
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis,
  ];
  for (const rgx of regexes) {
    let m;
    while ((m = rgx.exec(html))) {
      const maybeUrl = m.length === 3 ? m[1] : sourceUrl;
      const raw = m.length === 3 ? m[2] : m[1];
      const clean = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      if (clean.length >= 24 && clean.length <= 180) {
        try { candidates.set(clean, new URL(maybeUrl, sourceUrl).toString()); }
        catch { candidates.set(clean, sourceUrl); }
      }
    }
  }
  return [...candidates.entries()].slice(0, 40).map(([title, url]) => ({ title, url }));
}

async function scanMarketSource(source) {
  const res = await axios.get(source.url, {
    timeout: 25000,
    headers: { "User-Agent": "Mozilla/5.0 APEX-Telegram-Runtime/1.0" },
  });
  const html = String(res.data || "");
  const hash = crypto.createHash("sha256").update(html).digest("hex");
  const store = loadStore();
  const prev = store.market.sourceState[source.id];
  store.market.sourceState[source.id] = { hash, checkedAt: new Date().toISOString(), url: source.url };
  const candidates = extractCandidates(html, source.url);
  const signals = [];
  for (const c of candidates) {
    const score = relevanceScore(c.title, source.keywords);
    if (score >= 3) {
      const id = crypto.createHash("sha1").update(`${source.id}:${c.title}:${c.url}`).digest("hex").slice(0, 18);
      if (!store.market.signals.some((s) => s.id === id)) {
        const signal = { id, sourceId: source.id, sourceName: source.name, title: c.title, url: c.url, score, type: classifySignal(c.title), detectedAt: new Date().toISOString(), changed: !prev || prev.hash !== hash };
        store.market.signals.push(signal);
        signals.push(signal);
      }
    }
  }
  store.market.signals = store.market.signals.slice(-500);
  saveStore();
  return signals;
}

async function runMarketScan(chatId = null) {
  const found = [];
  for (const source of MARKET_SOURCES) {
    try {
      const signals = await scanMarketSource(source);
      found.push(...signals);
    } catch (e) {
      logEvent("market_source_failed", { source: source.id, error: e.message });
    }
  }
  const high = found.filter((s) => s.score >= 5).slice(0, 8);
  if (chatId && high.length) {
    const msg = `Market signals detected:\n\n${high.map((s) => `• ${s.title}\n  ${s.sourceName} | ${s.type} | ${s.score}/10\n  ${s.url}`).join("\n\n")}`;
    await safeSend(chatId, msg);
  }
  return found;
}

function marketSnapshot() {
  const since = Date.now() - 48 * 60 * 60 * 1000;
  const rows = loadStore().market.signals
    .filter((s) => new Date(s.detectedAt).getTime() >= since)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  if (!rows.length) return "No market signals stored in the last 48 hours. Run /scan first.";
  return `UAE/GCC AI Market Snapshot (48h)\n\n${rows.map((s) => `• ${s.title}\n  ${s.sourceName} | ${s.type} | ${s.score}/10\n  ${s.url}`).join("\n\n")}`;
}

// -----------------------------------------------------------------------------
// Wallet-safe TON handling
// -----------------------------------------------------------------------------
async function walletStatus() {
  if (!CONFIG.tonWalletAddress) {
    return "No TON_WALLET_ADDRESS configured. Add it to .env if you want read-only wallet status. I will not store private keys.";
  }
  if (CONFIG.tonWalletWebhookUrl) {
    try {
      const res = await axios.post(CONFIG.tonWalletWebhookUrl, { action: "status", address: CONFIG.tonWalletAddress }, { timeout: 15000 });
      return `TON wallet configured.\nAddress: ${CONFIG.tonWalletAddress}\nWebhook response:\n${JSON.stringify(res.data, null, 2).slice(0, 1500)}`;
    } catch (e) {
      return `TON wallet configured, but wallet webhook failed: ${e.message}\nAddress: ${CONFIG.tonWalletAddress}`;
    }
  }
  return `TON wallet configured in read-only safe mode.\nAddress: ${CONFIG.tonWalletAddress}\n\nNo signing, transfer, or private-key handling is implemented in this bot.`;
}

// -----------------------------------------------------------------------------
// Command handling
// -----------------------------------------------------------------------------
function helpText() {
  return `APEX Telegram Runtime\n\nCore\n/start — initialize\n/status — system health\n/whoami — show Telegram IDs\n/help — command list\n/activation always|mention — group behavior\n\nMemory + work\n/remember [text] — remember in this chat\n/remember_global [text] — remember globally\n/memory — show memory\n/note [text] — save note\n/notes — list notes\n/todo [text] — add task\n/todos — list tasks\n/done [todo_id] — mark task complete\n\nS/ Skills\n/synthesize [topic]\n/gov [context]\n/kpi [objective]\n/evidence [claim]\n/boardroom [topic]\n/critique [proposal]\n/secretary [task]\n/skills — list skills\n\nContent + signals\n/social — create 3 content options + approval cards\n/scan — scan public market sources now\n/market — latest market snapshot\n/competitors — tracked competitors\n/monitor add [url]\n/monitor list\n\nControls\n/approvals — pending approvals\n/approve [id]\n/reject [id]\n/wallet — safe TON wallet status\n/handoff [text] — send task to n8n webhook if configured\n\nJust send any normal message to chat with APEX.`;
}

async function handleCommand(msg, text) {
  const chatId = chatIdOf(msg);
  const lower = text.toLowerCase().trim();

  if (/^\/start\b/.test(lower)) {
    return safeSend(chatId, `APEX is online for ${CONFIG.ownerName}.\n\n${helpText()}`);
  }

  if (/^\/help\b/.test(lower)) return safeSend(chatId, helpText());

  if (/^\/whoami\b/.test(lower)) {
    return safeSend(chatId, `Telegram IDs\n\nUser ID: ${userIdOf(msg)}\nChat ID: ${chatIdOf(msg)}\nChat type: ${chatTypeOf(msg)}\nThread ID: ${threadIdOf(msg)}\nBot: @${BOT_USERNAME || "unknown"}`);
  }

  if (/^\/status\b/.test(lower)) {
    const store = loadStore();
    return safeSend(chatId, `Status: online\nOwner: ${CONFIG.ownerName}\nBot: @${BOT_USERNAME || "unknown"}\nModel: ${CONFIG.groqApiKey ? CONFIG.model : "not configured"}\nMode: ${CONFIG.mode}\nPrivate mode: ${CONFIG.privateMode}\nOwner paired: ${store.owner ? "yes" : "no"}\nSessions: ${Object.keys(store.sessions).length}\nPending approvals: ${listPendingApprovals().length}\nStorage: ${DATA_DIR}`);
  }

  if (/^\/activation\b/.test(lower)) {
    const mode = lower.includes("always") ? "always" : lower.includes("mention") ? "mention" : "";
    if (!mode) return safeSend(chatId, "Use /activation always or /activation mention");
    const session = getSession(msg);
    session.activation = mode;
    session.updatedAt = new Date().toISOString();
    saveStore();
    return safeSend(chatId, `Activation set to: ${mode}`);
  }

  if (/^\/skills\b/.test(lower)) {
    return safeSend(chatId, Object.values(S_AGENTS).map((a) => `${a.commands.join(", ")} — ${a.name}`).join("\n"));
  }

  if (/^\/remember_global\b/.test(lower)) {
    const memory = stripCommand(text);
    if (!memory) return safeSend(chatId, "Send /remember_global followed by what to remember.");
    addMemory(msg, memory, "global");
    return safeSend(chatId, "Saved to global memory.");
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

  if (/^\/social\b/.test(lower)) {
    await runSocialWorkflow(chatId);
    return;
  }

  if (/^\/scan\b/.test(lower)) {
    const m = await bot.sendMessage(chatId, "Scanning market sources…");
    const found = await runMarketScan(chatId);
    return safeEdit(chatId, m.message_id, `Scan complete. New signals: ${found.length}\n\nUse /market to view snapshot.`);
  }

  if (/^\/market\b/.test(lower)) return safeSend(chatId, marketSnapshot());

  if (/^\/competitors\b/.test(lower) || /^\/competitor\b/.test(lower)) {
    return safeSend(chatId, `Tracked competitors:\n${COMPETITORS.map((c) => `• ${c.name} — ${c.website} [${c.tags.join(", ")}]`).join("\n")}`);
  }

  if (/^\/monitor\b/.test(lower)) {
    const parts = text.trim().split(/\s+/);
    const sub = parts[1];
    const url = parts[2];
    const store = loadStore();
    if (sub === "add" && url) {
      store.market.watchlist.push({ id: crypto.randomUUID(), url, active: true, addedAt: new Date().toISOString() });
      saveStore();
      return safeSend(chatId, `Added to watchlist:\n${url}`);
    }
    if (sub === "list") {
      const rows = store.market.watchlist.filter((w) => w.active);
      return safeSend(chatId, rows.length ? rows.map((w) => `• ${w.url}`).join("\n") : "Watchlist is empty.");
    }
    return safeSend(chatId, "Use /monitor add [url] or /monitor list");
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

  if (/^\/wallet\b/.test(lower)) {
    if (lower.includes("send") || lower.includes("transfer")) {
      const approval = createApproval({
        type: "wallet",
        title: "Wallet action requested",
        content: "A wallet action was requested. This bot will not sign or transfer funds. Use this approval only to hand off to your external wallet workflow.",
        payload: { text },
        chatId,
      });
      await sendApprovalCard(chatId, approval);
      return;
    }
    return safeSend(chatId, await walletStatus());
  }

  if (/^\/handoff\b/.test(lower)) {
    const task = stripCommand(text);
    if (!CONFIG.n8nWebhookUrl) return safeSend(chatId, "N8N_WEBHOOK_URL is not configured in .env.");
    if (!task) return safeSend(chatId, "Send /handoff followed by the task.");
    const lane = /\blane:\s*(\w+)/i.exec(task)?.[1] || "laptop_pickup";
    const payload = { source: "telegram", from: userIdOf(msg), chatId, task, lane };
    const res = await axios.post(CONFIG.n8nWebhookUrl, payload, { timeout: 20000 }).catch((e) => ({ error: e }));
    if (res.error) return safeSend(chatId, `n8n handoff failed: ${res.error.message}`);
    const cid = res.data?.command_id;
    return safeSend(chatId, cid ? `Queued \`${cid}\` (lane: ${lane}). Laptop or Cursor Cloud will pick up.` : `Queued (lane: ${lane}).`);
  }

  const selectedAgent = skillForText(text);
  if (selectedAgent && selectedAgent.commands.some((c) => lower.startsWith(c))) {
    const preview = await bot.sendMessage(chatId, `${selectedAgent.name} is preparing…`);
    const reply = await askGroq({ msg, text, selectedAgent, previewMessage: preview });
    pushHistory(msg, "user", text);
    pushHistory(msg, "assistant", reply);
    await safeEdit(chatId, preview.message_id, `${reply}\n\n— APEX`);
    return;
  }

  return false;
}

async function handleNormalMessage(msg, text) {
  const chatId = chatIdOf(msg);
  const selectedAgent = skillForText(text);
  const preview = await bot.sendMessage(chatId, selectedAgent ? `${selectedAgent.name} is preparing…` : "APEX is preparing…");
  const reply = await askGroq({ msg, text, selectedAgent, previewMessage: preview });
  pushHistory(msg, "user", text);
  pushHistory(msg, "assistant", reply);
  await safeEdit(chatId, preview.message_id, `${reply}\n\n— APEX`);
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

// -----------------------------------------------------------------------------
// HTTP / n8n endpoints
// -----------------------------------------------------------------------------
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
      messages: [{ role: "system", content: S_BASE_SYSTEM }, { role: "user", content: message }],
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
    if (action === "market_scan") {
      const found = await runMarketScan(chatId || null);
      return res.json({ ok: true, action, found: found.length });
    }
    if (action === "social") {
      if (!chatId) return res.status(400).json({ ok: false, error: "chatId required" });
      await runSocialWorkflow(chatId);
      return res.json({ ok: true, action });
    }
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

// -----------------------------------------------------------------------------
// Startup
// -----------------------------------------------------------------------------
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

  if (CONFIG.marketCronEnabled) {
    cron.schedule(CONFIG.marketCron, async () => {
      const chatId = CONFIG.ownerChatId || loadStore().owner?.chatId;
      await runMarketScan(chatId || null);
    });
    console.log(`Market cron enabled: ${CONFIG.marketCron}`);
  }

  app.listen(CONFIG.port, () => {
    console.log(`${CONFIG.appName} running on port ${CONFIG.port}`);
    console.log(`Telegram bot: @${BOT_USERNAME}`);
    console.log(`Mode: ${CONFIG.mode}`);
    console.log(`Health: http://localhost:${CONFIG.port}/health`);
    if (!CONFIG.groqApiKey) console.warn("GROQ_API_KEY missing: Telegram commands work, AI replies will not.");
    if (!CONFIG.ownerTelegramUserId && CONFIG.autoPairFirstUser) console.warn("AUTO_PAIR_FIRST_USER=true: first /start DM becomes owner.");
  });
}

start().catch((e) => {
  console.error("Startup failed:", e);
  process.exit(1);
});
