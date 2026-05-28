import React, { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Cloud,
  FileText,
  Folder,
  KeyRound,
  Layers,
  Lock,
  MessageCircle,
  Mic,
  PlugZap,
  Radio,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareCode,
  Timer,
  UserRound,
  WalletCards,
  Zap,
} from "lucide-react";

const cx = (...classes) => classes.filter(Boolean).join(" ");

const DEFAULT_STATE = {
  ownerName: "Seif Alsoub",
  botName: "S/Secretary",
  telegramHandle: "@your_bot",
  ownerId: "pair on first /start",
  groqModel: "llama-3.3-70b-versatile",
  botTokenSet: false,
  groqKeySet: false,
  privateMode: true,
  autoPair: true,
  groupMode: true,
  requireMention: true,
  replyVoice: true,
  respondTagged: true,
  respondReplied: true,
  respondRelevant: true,
  approvalExternal: true,
  approvalMoney: true,
  approvalPublish: true,
  approvalWallet: true,
  selectedModule: "Knowledge",
  memoryDraft: "S/Secretary should be concise, useful, warm, practical, and only ask approval for money, publishing, external sending, or commitments.",
  memories: [
    "Use S/Secretary name across Telegram and web app.",
    "Prefer practical buttons and visual controls over slash-only instructions.",
    "Keep approvals only for money, publishing, external sending, or commitments.",
  ],
  tasks: [
    { title: "Pair Telegram owner", status: "Ready", due: "First /start" },
    { title: "Add Groq key to .env", status: "Ready", due: "Before launch" },
    { title: "Connect n8n webhook bridge", status: "Optional", due: "After bot replies" },
  ],
  logs: [
    "S/Secretary web control app loaded.",
    "Private mode enabled.",
    "OpenClaw-style modules mapped into visual controls.",
  ],
};

const modules = [
  {
    name: "Knowledge",
    icon: Brain,
    tone: "from-violet-500/25 to-purple-500/5",
    desc: "Memories, reusable rules, profile preferences, operating notes.",
    actions: ["Add Memory", "Search Notes", "Export JSON"],
  },
  {
    name: "Accounts",
    icon: KeyRound,
    tone: "from-emerald-500/20 to-teal-500/5",
    desc: "Credential checklist without exposing secrets inside the UI.",
    actions: ["Check .env", "Copy Template", "Rotate Reminder"],
  },
  {
    name: "Tasks",
    icon: Timer,
    tone: "from-amber-500/20 to-orange-500/5",
    desc: "Light task capture, due labels, and Telegram reminders.",
    actions: ["Add Task", "Today", "Pending"],
  },
  {
    name: "Wallet",
    icon: WalletCards,
    tone: "from-blue-500/20 to-cyan-500/5",
    desc: "TON wallet-safe view. Read-only by default; payment movement requires approval.",
    actions: ["View Status", "Approval Gate", "Audit"],
  },
  {
    name: "Files",
    icon: Folder,
    tone: "from-slate-400/20 to-slate-500/5",
    desc: "Documents, screenshots, drafts, and Telegram attachments.",
    actions: ["Save File", "Summarize", "Create Pack"],
  },
  {
    name: "Social",
    icon: Sparkles,
    tone: "from-rose-500/20 to-orange-500/5",
    desc: "Trend shortlist, content drafts, visual prompts, approval cards.",
    actions: ["Discover", "Draft", "Approve"],
  },
  {
    name: "Signals",
    icon: Radio,
    tone: "from-lime-500/20 to-green-500/5",
    desc: "Market, government, AI, tender, and opportunity scanning.",
    actions: ["Scan", "Score", "Notify"],
  },
  {
    name: "Workflows",
    icon: PlugZap,
    tone: "from-fuchsia-500/20 to-violet-500/5",
    desc: "n8n-friendly workflow payloads and webhook bridge.",
    actions: ["Copy Payload", "Webhook", "Test"],
  },
];

const miniAgents = [
  { name: "Sally", role: "Executive Telegram secretary", state: "Online" },
  { name: "Ruba", role: "Visual asset designer", state: "Ready" },
  { name: "Madame Lubna", role: "Quality review", state: "Ready" },
  { name: "Dima", role: "Reputation and visibility", state: "Ready" },
  { name: "Mansour", role: "Revenue pathway", state: "Ready" },
  { name: "Wa'el", role: "Connector wiring", state: "Ready" },
];

function Toggle({ checked, onChange, label, helper }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left transition hover:border-amber-300/30 hover:bg-white/[0.06]"
    >
      <span>
        <span className="block text-sm font-semibold text-slate-100">{label}</span>
        {helper ? <span className="mt-1 block text-xs text-slate-400">{helper}</span> : null}
      </span>
      <span
        className={cx(
          "relative h-7 w-12 rounded-full border transition",
          checked ? "border-amber-300/60 bg-amber-300/25" : "border-white/15 bg-slate-950"
        )}
      >
        <span
          className={cx(
            "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition",
            checked ? "left-6" : "left-1"
          )}
        />
      </span>
    </button>
  );
}

function Card({ children, className = "" }) {
  return <div className={cx("rounded-[2rem] border border-white/10 bg-slate-950/60 shadow-2xl shadow-black/30 backdrop-blur", className)}>{children}</div>;
}

function Button({ children, onClick, variant = "primary", className = "" }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition active:scale-[0.98]",
        variant === "primary" && "bg-gradient-to-r from-amber-300 to-orange-400 text-slate-950 shadow-lg shadow-amber-500/20 hover:brightness-110",
        variant === "ghost" && "border border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.07]",
        variant === "soft" && "bg-amber-300/10 text-amber-200 ring-1 ring-amber-300/20 hover:bg-amber-300/15",
        className
      )}
    >
      {children}
    </button>
  );
}

function Pill({ children, active = false }) {
  return (
    <span className={cx("rounded-full px-3 py-1 text-xs font-semibold", active ? "bg-emerald-300/15 text-emerald-200 ring-1 ring-emerald-300/30" : "bg-white/5 text-slate-300 ring-1 ring-white/10")}>{children}</span>
  );
}

function ChatBubble({ side = "bot", children, muted }) {
  return (
    <div className={cx("flex", side === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[82%] rounded-3xl px-4 py-3 text-sm leading-relaxed",
          side === "user" ? "bg-violet-500/80 text-white" : "bg-white/[0.07] text-slate-100 ring-1 ring-white/10",
          muted && "opacity-70"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export default function SSecretaryWebApp() {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem("s_secretary_app_state");
      return saved ? { ...DEFAULT_STATE, ...JSON.parse(saved) } : DEFAULT_STATE;
    } catch {
      return DEFAULT_STATE;
    }
  });
  const [activeTab, setActiveTab] = useState("Control");
  const [copied, setCopied] = useState("");
  const [taskDraft, setTaskDraft] = useState("Prepare Telegram-ready S/Secretary launch test");

  useEffect(() => {
    localStorage.setItem("s_secretary_app_state", JSON.stringify(state));
  }, [state]);

  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  const envTemplate = useMemo(() => {
    return `TELEGRAM_BOT_TOKEN=replace_with_botfather_token\nGROQ_API_KEY=replace_with_groq_key\nINTERNAL_API_SECRET=change_this_long_random_text\nOWNER_NAME=${state.ownerName}\nBOT_NAME=${state.botName}\nPRIVATE_MODE=${state.privateMode}\nAUTO_PAIR_FIRST_USER=${state.autoPair}\nGROUP_MODE=${state.groupMode}\nREQUIRE_MENTION=${state.requireMention}\nGROQ_MODEL=${state.groqModel}\nN8N_WEBHOOK_URL=http://localhost:5678/webhook/s-secretary\n`;
  }, [state]);

  const nodeRun = `cd C:\\Users\\saifs\\OneDrive\\Desktop\\apex-openclaw-telegram-onefile\nnpm install\nnode .\\apex-openclaw-telegram.js`;

  const n8nPayload = useMemo(() => JSON.stringify({
    source: "telegram",
    bot: "S/Secretary",
    event: "incoming_message",
    approval_required_for: ["money", "publishing", "external_sending", "commitments", "wallet_movement"],
    respond_when: {
      tagged_by_name: state.respondTagged,
      replied_to: state.respondReplied,
      conversation_relevant: state.respondRelevant,
    },
    modules: modules.map((m) => m.name),
  }, null, 2), [state]);

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      set((s) => ({ logs: [`Copied ${label}.`, ...s.logs].slice(0, 8) }));
      setTimeout(() => setCopied(""), 1400);
    } catch {
      setCopied("Copy manually");
    }
  };

  const addMemory = () => {
    const text = state.memoryDraft.trim();
    if (!text) return;
    set({
      memories: [text, ...state.memories].slice(0, 8),
      memoryDraft: "",
      logs: [`Memory saved: ${text.slice(0, 64)}...`, ...state.logs].slice(0, 8),
    });
  };

  const addTask = () => {
    const text = taskDraft.trim();
    if (!text) return;
    set({
      tasks: [{ title: text, status: "Ready", due: "Today" }, ...state.tasks].slice(0, 8),
      logs: [`Task added: ${text}`, ...state.logs].slice(0, 8),
    });
    setTaskDraft("");
  };

  const tabs = ["Control", "Bot Settings", "Modules", "Deploy", "n8n", "Memory", "Tasks"];
  const activeModule = modules.find((m) => m.name === state.selectedModule) || modules[0];
  const ModuleIcon = activeModule.icon;

  return (
    <div className="min-h-screen bg-[#08090f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[-10%] h-[40rem] w-[40rem] rounded-full bg-violet-700/20 blur-3xl" />
        <div className="absolute bottom-[-12%] right-[-12%] h-[42rem] w-[42rem] rounded-full bg-amber-600/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_30%),linear-gradient(transparent_0,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,transparent_0,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:auto,64px_64px,64px_64px]" />
      </div>

      <main className="relative mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-300 via-orange-400 to-violet-500 text-slate-950 shadow-xl shadow-orange-500/20">
              <Bot className="h-7 w-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight md:text-3xl">S/Secretary</h1>
                <Pill active>Telegram-ready</Pill>
                <Pill>Visual control app</Pill>
              </div>
              <p className="mt-1 text-sm text-slate-400">A clean OpenClaw-style assistant console: settings, modules, memory, tasks, approvals, and n8n bridge.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" onClick={() => copy(envTemplate, ".env")}> <Clipboard className="h-4 w-4" /> Copy .env</Button>
            <Button onClick={() => setActiveTab("Deploy")}> <Zap className="h-4 w-4" /> Launch Path</Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[280px_1fr_390px]">
          <Card className="p-3 lg:min-h-[780px]">
            <div className="mb-3 flex items-center gap-3 rounded-3xl bg-white/[0.04] p-3">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{state.botName}</p>
                <p className="truncate text-xs text-slate-400">{state.telegramHandle}</p>
              </div>
            </div>

            <div className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cx(
                    "flex w-full items-center justify-between rounded-2xl px-3 py-3 text-sm font-semibold transition",
                    activeTab === tab ? "bg-amber-300/15 text-amber-100 ring-1 ring-amber-300/25" : "text-slate-300 hover:bg-white/[0.05]"
                  )}
                >
                  <span>{tab}</span>
                  <ChevronRight className="h-4 w-4 opacity-60" />
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Assistant Team</p>
              <div className="mt-3 space-y-3">
                {miniAgents.map((agent) => (
                  <div key={agent.name} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-100">{agent.name}</p>
                      <p className="text-xs text-slate-500">{agent.role}</p>
                    </div>
                    <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-300/20">{agent.state}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="border-b border-white/10 bg-white/[0.035] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-200/70">{activeTab}</p>
                    <h2 className="mt-1 text-2xl font-black tracking-tight">{activeTab === "Control" ? "Live assistant control" : activeTab}</h2>
                  </div>
                  <div className="flex gap-2">
                    <Pill active={state.privateMode}>Private Mode</Pill>
                    <Pill active={state.autoPair}>First /start Pairing</Pill>
                  </div>
                </div>
              </div>

              {activeTab === "Control" && (
                <div className="grid gap-5 p-5 xl:grid-cols-[1fr_330px]">
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      {[
                        { label: "Owner", value: state.ownerName, icon: UserRound },
                        { label: "Model", value: state.groqModel, icon: Brain },
                        { label: "Status", value: "Ready after .env", icon: CheckCircle2 },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.label} className="rounded-3xl border border-white/10 bg-white/[0.035] p-4">
                            <Icon className="h-5 w-5 text-amber-200" />
                            <p className="mt-3 text-xs text-slate-500">{item.label}</p>
                            <p className="mt-1 truncate text-sm font-bold text-slate-100">{item.value}</p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Toggle checked={state.privateMode} onChange={(v) => set({ privateMode: v })} label="Private assistant mode" helper="Only paired/allowed users can control the assistant." />
                      <Toggle checked={state.autoPair} onChange={(v) => set({ autoPair: v })} label="Auto-pair first private user" helper="Simple launch path: first /start becomes the owner." />
                      <Toggle checked={state.groupMode} onChange={(v) => set({ groupMode: v })} label="Telegram group mode" helper="Works in groups after allowlist or pairing setup." />
                      <Toggle checked={state.requireMention} onChange={(v) => set({ requireMention: v })} label="Require mention in groups" helper="Prevents noisy group replies unless S/Secretary is addressed." />
                    </div>

                    <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black">Selected module</h3>
                          <p className="text-sm text-slate-400">Choose what the Telegram assistant should focus on.</p>
                        </div>
                        <ModuleIcon className="h-7 w-7 text-amber-200" />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {modules.slice(0, 8).map((m) => {
                          const Icon = m.icon;
                          const active = state.selectedModule === m.name;
                          return (
                            <button key={m.name} onClick={() => set({ selectedModule: m.name })} className={cx("rounded-3xl border p-4 text-left transition", active ? "border-amber-300/40 bg-amber-300/10" : "border-white/10 bg-black/20 hover:bg-white/[0.05]")}> 
                              <Icon className="h-5 w-5 text-amber-200" />
                              <p className="mt-3 text-sm font-bold">{m.name}</p>
                              <p className="mt-1 line-clamp-2 text-xs text-slate-400">{m.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <TelegramPreview state={state} activeModule={activeModule} />
                </div>
              )}

              {activeTab === "Bot Settings" && (
                <div className="grid gap-5 p-5 xl:grid-cols-2">
                  <div className="space-y-4">
                    <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
                      <h3 className="flex items-center gap-2 text-lg font-black"><Settings className="h-5 w-5 text-amber-200" /> Behaviour</h3>
                      <div className="mt-4 space-y-3">
                        <Toggle checked={state.replyVoice} onChange={(v) => set({ replyVoice: v })} label="Reply with voice" helper="Voice replies can be enabled for Telegram messages." />
                        <Toggle checked={state.respondTagged} onChange={(v) => set({ respondTagged: v })} label="Respond when tagged by name" />
                        <Toggle checked={state.respondReplied} onChange={(v) => set({ respondReplied: v })} label="Respond when replied to" />
                        <Toggle checked={state.respondRelevant} onChange={(v) => set({ respondRelevant: v })} label="Respond when conversation is relevant" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
                      <h3 className="flex items-center gap-2 text-lg font-black"><ShieldCheck className="h-5 w-5 text-amber-200" /> Approval gates</h3>
                      <div className="mt-4 space-y-3">
                        <Toggle checked={state.approvalMoney} onChange={(v) => set({ approvalMoney: v })} label="Money and payments" helper="Always asks before invoices, payment links, or commitments." />
                        <Toggle checked={state.approvalPublish} onChange={(v) => set({ approvalPublish: v })} label="Publishing" helper="Approval card required before posting." />
                        <Toggle checked={state.approvalExternal} onChange={(v) => set({ approvalExternal: v })} label="External sending" helper="Emails, proposals, messages, or client commitments." />
                        <Toggle checked={state.approvalWallet} onChange={(v) => set({ approvalWallet: v })} label="Wallet movement" helper="Wallet remains read-only unless approved." />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "Modules" && (
                <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                  {modules.map((m) => {
                    const Icon = m.icon;
                    return (
                      <div key={m.name} className={cx("rounded-[2rem] border border-white/10 bg-gradient-to-br p-5", m.tone)}>
                        <div className="flex items-start justify-between gap-3">
                          <Icon className="h-6 w-6 text-amber-100" />
                          <Pill active>Enabled</Pill>
                        </div>
                        <h3 className="mt-4 text-lg font-black">{m.name}</h3>
                        <p className="mt-2 min-h-[48px] text-sm text-slate-300">{m.desc}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {m.actions.map((a) => <span key={a} className="rounded-full bg-black/25 px-2.5 py-1 text-xs text-slate-300 ring-1 ring-white/10">{a}</span>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === "Deploy" && (
                <div className="grid gap-5 p-5 xl:grid-cols-2">
                  <DeployCard title="Recommended: direct Node launch" icon={SquareCode} badge="Fastest" description="Use this when Docker Desktop is not running. This is the simplest stable launch path on Windows." code={nodeRun} onCopy={() => copy(nodeRun, "Node launch commands")} />
                  <DeployCard title="Required .env" icon={FileText} badge="Secrets" description="Paste this into .env. Keep your real keys private and rotate any key exposed in old files." code={envTemplate} onCopy={() => copy(envTemplate, ".env template")} />
                  <div className="xl:col-span-2 rounded-[2rem] border border-emerald-300/20 bg-emerald-300/10 p-5">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-1 h-6 w-6 text-emerald-200" />
                      <div>
                        <h3 className="text-lg font-black text-emerald-100">Best launch flow</h3>
                        <p className="mt-2 text-sm text-emerald-50/80">Start with Node direct. Once Telegram replies reliably, connect n8n as an optional workflow bridge. Docker is useful later, but it should not block your first working bot.</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "n8n" && (
                <div className="grid gap-5 p-5 xl:grid-cols-[1fr_360px]">
                  <DeployCard title="n8n webhook payload" icon={Cloud} badge="Bridge" description="Use this as the standard event object when Telegram sends a message into an n8n workflow." code={n8nPayload} onCopy={() => copy(n8nPayload, "n8n payload")} />
                  <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
                    <h3 className="text-lg font-black">Workflow shape</h3>
                    <div className="mt-4 space-y-3 text-sm text-slate-300">
                      {["Telegram Trigger", "S/Secretary Classifier", "Module Router", "Approval Check", "Reply or Queue", "Audit Log"].map((step, i) => (
                        <div key={step} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-300/15 text-xs font-black text-amber-200">{i + 1}</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "Memory" && (
                <div className="grid gap-5 p-5 xl:grid-cols-[1fr_360px]">
                  <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
                    <h3 className="flex items-center gap-2 text-lg font-black"><Brain className="h-5 w-5 text-amber-200" /> Memory builder</h3>
                    <textarea
                      value={state.memoryDraft}
                      onChange={(e) => set({ memoryDraft: e.target.value })}
                      className="mt-4 min-h-[150px] w-full rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-100 outline-none ring-amber-300/0 transition placeholder:text-slate-600 focus:border-amber-300/30 focus:ring-4 focus:ring-amber-300/10"
                      placeholder="Write a memory or rule for S/Secretary..."
                    />
                    <div className="mt-3 flex justify-end">
                      <Button onClick={addMemory}><Save className="h-4 w-4" /> Save memory</Button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {state.memories.map((m, i) => (
                      <div key={`${m}-${i}`} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">
                        <p>{m}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "Tasks" && (
                <div className="grid gap-5 p-5 xl:grid-cols-[1fr_360px]">
                  <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
                    <h3 className="flex items-center gap-2 text-lg font-black"><Timer className="h-5 w-5 text-amber-200" /> Add Telegram task</h3>
                    <input
                      value={taskDraft}
                      onChange={(e) => setTaskDraft(e.target.value)}
                      className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-300/30"
                      placeholder="Task name..."
                    />
                    <div className="mt-3 flex justify-end">
                      <Button onClick={addTask}><CheckCircle2 className="h-4 w-4" /> Add task</Button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {state.tasks.map((t, i) => (
                      <div key={`${t.title}-${i}`} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-slate-100">{t.title}</p>
                            <p className="mt-1 text-xs text-slate-500">Due: {t.due}</p>
                          </div>
                          <Pill>{t.status}</Pill>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black">System notes</h3>
                  <p className="text-sm text-slate-400">Local UI log for copied configs and saved items.</p>
                </div>
                {copied ? <Pill active>{copied}</Pill> : null}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {state.logs.map((log, i) => (
                  <div key={`${log}-${i}`} className="rounded-2xl bg-white/[0.035] px-4 py-3 text-xs text-slate-400 ring-1 ring-white/10">{log}</div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden lg:min-h-[780px]">
            <div className="border-b border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-500">
                  <MessageCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-black">Telegram Mini Control</p>
                  <p className="text-xs text-slate-500">How S/Secretary should feel inside Telegram</p>
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="rounded-[2rem] border border-white/10 bg-[#111217] p-4 shadow-inner">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-amber-300 to-violet-500" />
                    <div>
                      <p className="text-sm font-black">S/Secretary</p>
                      <p className="text-xs text-emerald-300">online</p>
                    </div>
                  </div>
                  <Settings className="h-5 w-5 text-slate-400" />
                </div>

                <div className="mt-4 space-y-3">
                  <Toggle checked={state.replyVoice} onChange={(v) => set({ replyVoice: v })} label="Reply with voice" />
                  <div className="rounded-3xl bg-black/25 p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-violet-300/80">Respond when</p>
                    <div className="space-y-2">
                      <Toggle checked={state.respondTagged} onChange={(v) => set({ respondTagged: v })} label="Tagged by name" />
                      <Toggle checked={state.respondReplied} onChange={(v) => set({ respondReplied: v })} label="Replied to" />
                      <Toggle checked={state.respondRelevant} onChange={(v) => set({ respondRelevant: v })} label="Conversation is relevant" />
                    </div>
                  </div>
                  <div className="rounded-3xl bg-black/25 p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-violet-300/80">Modules</p>
                    {modules.slice(0, 6).map((m) => {
                      const Icon = m.icon;
                      return (
                        <button key={m.name} onClick={() => { set({ selectedModule: m.name }); setActiveTab("Control"); }} className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-semibold text-slate-200 hover:bg-white/[0.06]">
                          <span className="flex items-center gap-3"><Icon className="h-4 w-4 text-amber-200" />{m.name}</span>
                          <ChevronRight className="h-4 w-4 text-slate-500" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}

function TelegramPreview({ state, activeModule }) {
  const Icon = activeModule.icon;
  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#0e1017] p-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-violet-500 text-slate-950">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black">S/Secretary</p>
            <p className="text-xs text-slate-500">Telegram preview</p>
          </div>
        </div>
        <Pill active>{activeModule.name}</Pill>
      </div>
      <div className="mt-4 space-y-3">
        <ChatBubble side="user">Can you check what matters today and prepare the useful next action?</ChatBubble>
        <ChatBubble>
          <div className="flex items-start gap-3">
            <Icon className="mt-1 h-5 w-5 shrink-0 text-amber-200" />
            <div>
              <p className="font-bold">Good morning, Mr Seif.</p>
              <p className="mt-1 text-slate-300">I’ll focus on <span className="font-semibold text-amber-100">{activeModule.name}</span>, keep it practical, and only request approval for money, publishing, external sending, commitments, or wallet movement.</p>
            </div>
          </div>
        </ChatBubble>
        <ChatBubble muted>
          Current behavior: {state.requireMention ? "mention-required in groups" : "active in allowed groups"}, {state.replyVoice ? "voice replies enabled" : "voice replies off"}, private mode {state.privateMode ? "on" : "off"}.
        </ChatBubble>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="ghost"><Mic className="h-4 w-4" /> Voice</Button>
        <Button variant="ghost"><Search className="h-4 w-4" /> Search</Button>
        <Button variant="ghost"><Layers className="h-4 w-4" /> Modules</Button>
        <Button variant="ghost"><Lock className="h-4 w-4" /> Approvals</Button>
      </div>
    </div>
  );
}

function DeployCard({ title, description, code, icon: Icon, badge, onCopy }) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-300/10 ring-1 ring-amber-300/20">
            <Icon className="h-5 w-5 text-amber-200" />
          </div>
          <div>
            <h3 className="font-black">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          </div>
        </div>
        <Pill active>{badge}</Pill>
      </div>
      <pre className="max-h-[260px] overflow-auto rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-relaxed text-slate-300"><code>{code}</code></pre>
      <div className="mt-3 flex justify-end">
        <Button variant="soft" onClick={onCopy}><Clipboard className="h-4 w-4" /> Copy</Button>
      </div>
    </div>
  );
}
