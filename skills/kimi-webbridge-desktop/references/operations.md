# Operations: diagnose and recover (Desktop App variant)

Read this file when the health check in SKILL.md indicates the daemon isn't responding or the extension isn't connected.

## Key rule for this variant

The **Kimi Desktop App** owns the daemon's lifecycle. Do **NOT** run CLI commands like `kimi-webbridge stop` / `restart` / `uninstall` — those would fight the app.

All recovery flows through the Desktop App:
- Daemon not responding? → Ask the user to close and reopen the Kimi Desktop App.
- Extension not connecting? → Ask the user to verify the extension is installed and enabled in Chrome/Edge.

## Routing table

Run: `curl -s http://127.0.0.1:10086/status`

| Observed | Action |
|---|---|
| connection refused / no response | Desktop App is not running. Tell the user: "Please open the Kimi Desktop App." |
| `{"running": true, "extension_connected": false, ...}` | Extension not connected. Tell the user: "Please make sure the Kimi WebBridge browser extension is installed and enabled. See https://www.kimi.com/features/webbridge (中文: https://www.kimi.com/zh-cn/features/webbridge) for instructions." |
| `{"running": true, "extension_connected": true, ...}` | Healthy. Return to SKILL.md to make tool calls. |
| Tool call succeeds but results look wrong / hangs | Desktop App may have stalled. Tell the user: "Please close and reopen the Kimi Desktop App." |

## /status JSON fields

- `running` (bool) — daemon listening on `:10086`
- `port` (int) — 10086
- `version` (string) — daemon build version
- `extension_connected` (bool) — a WebSocket client is attached
- `extension_id` (string) — the Chrome/Edge extension ID, empty if none
- `uptime_seconds` (int)

## Diagnosing common failures

| Symptom | Action |
|---|---|
| `curl` returns "connection refused" | Desktop App is not running. Ask user to open it. |
| Tool calls time out | Desktop App may have stalled. Ask user to close and reopen it. |
| `extension_connected` stays `false` after app reopen | Browser extension not installed or disabled. Direct user to https://www.kimi.com/features/webbridge (中文: https://www.kimi.com/zh-cn/features/webbridge). |
| `status` returns `extension_connected: true` but tool call fails | May be a multi-browser conflict — ask user to ensure only one browser (Chrome or Edge) has the extension enabled at a time. |

## What NOT to do

- Don't run `~/.kimi-webbridge/bin/kimi-webbridge stop` — will kill the Desktop App's daemon
- Don't run `~/.kimi-webbridge/bin/kimi-webbridge restart` — creates a ghost daemon the app doesn't know about
- Don't run `~/.kimi-webbridge/bin/kimi-webbridge uninstall` — removes the daemon binary the app depends on

If the user is troubleshooting deeply and explicitly asks for CLI control of the daemon, point them to install it standalone via:

```
curl -fsSL https://cdn.kimi.com/webbridge/install.sh | bash
```

That path installs the CLI variant of the `kimi-webbridge` skill (with CLI ops content) — it will overwrite this Desktop variant at `~/.claude/skills/kimi-webbridge/`, so only do this if the user is switching off the Desktop App.
