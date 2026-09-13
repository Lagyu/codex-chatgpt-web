<h1 align="center">ChatGPT Web for Codex</h1>

<p align="center">
  <strong>Use ChatGPT Web (including Pro) as native Codex models.</strong><br>
  Change the model tier, save your workflow.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="TROUBLESHOOTING.md">Troubleshooting</a> · <a href="SECURITY.md">Security</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/miuuyy/codex-chatgpt-web/actions/workflows/ci.yml"><img src="https://github.com/miuuyy/codex-chatgpt-web/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/macOS-arm64%20%7C%20x64-black?logo=apple" alt="macOS arm64 and x64">
  <img src="https://img.shields.io/badge/Windows-x64-0078d4?logo=windows11" alt="Windows x64">
  <img src="https://img.shields.io/badge/Linux-x64-fcc624?logo=linux&logoColor=black" alt="Linux x64">
  <img src="https://img.shields.io/badge/Free_AI-no_API_fees-10a37f" alt="Free AI with no API fees">
</p>

Free and Go accounts get **ChatGPT Web — Luna** in Codex's native model picker. Accounts that
expose the reasoning selector keep **Instant**, **Medium**, **High**, **Extra High**, and **Pro** as
their subscription allows. The bridge sends the current compiled Codex task context to a fresh
ChatGPT regular chat, attaches images, and streams visible reasoning, tool activity, and Markdown
back into the same Codex task.

<p align="center">
  <img src="assets/demo.gif" alt="A live ChatGPT Web turn using the native Codex harness" width="960">
</p>

```text
Codex task ──Responses + SSE──▶ codex-chatgpt-web ──embedded browser──▶ ChatGPT
     ▲                                │                                      │
     └──────── native UI, context, images, tracing, and tool lifecycle ──────┘
```

Codex keeps the native task, context lifecycle, UI, and tool harness. The local Responses bridge
routes only the selected model task through a task-bound ChatGPT regular chat; in full mode, MCP
connects ChatGPT back to the tools of that same Codex task. Pro retains its ChatGPT conversation
without Codex compaction; other efforts retain their existing context lifecycle.

## Pro retained-context build

This custom build (`5.0.7-pro-context.5`) normally sends one new user message per native Codex turn for
automatic Pro and Zero Risk Pro. The first message includes the task's initial instructions;
later messages contain only the new input. All local-tool/MCP rounds stay inside that turn's
single ChatGPT assistant response, except for the failure continuation described below.
Codex history replay, reconstruction, compaction, restart recovery, multipart transport, and staging
are disabled for Pro, including with Bigger Context on.

Regular chats are used for automatic and manual tasks, login, and verification. The bridge does
not toggle personalization. A visible **Thinking failed** status is detected even with its panel
collapsed. Automatic tasks can receive **up to five continuations per native turn, at any response
duration**, in the same verified conversation after outstanding tools settle. Retries wait
5, 10, 20, 40, then 60 seconds. A lingering Stop is cleared only for the confirmed failed response.
If the fifth continuation also fails, the settled chat is retained for a manual **Continue** in
the same Codex task; the normal 30-minute idle expiry and five-tab capacity still apply.
Original prompts, history, and tool calls are never replayed. Manual Zero Risk,
maintenance, staging, compaction, and Luna checkpoint capture do not automatically continue.
Switching chat mode is an operator-requested experiment; it is not a proven fix for ChatGPT's
underlying failure. See [regular chat policy](docs/adr/0004-regular-chats.md) and
[failure detection](docs/adr/0005-thinking-failed.md) and
[bounded failure recovery](docs/adr/0008-bounded-failure-recovery.md).

Start a new Codex task after installing and restarting the Launcher and Codex. Keep the task's
ChatGPT tab open. A missing chat or lost in-flight response produces an explicit error; it cannot
be recovered from the Codex transcript. Shorten a new message that exceeds the browser limit.
The existing launcher expires retained tabs after 30 idle minutes and may evict them at its
five-tab capacity; either event also ends Pro continuity.
Unset active `model_context_window` and `model_auto_compact_token_limit` overrides: Codex applies
these after model metadata and they can re-enable its scheduler. Pro compaction requests are
rejected regardless. Non-Pro context management remains available, but its staging messages can
no longer select Pro as a fallback for oversized payloads.

See the [decision record](docs/adr/0001-pro-context.md) for implementation, experiments, and limits.

> [!TIP]
> I also built **[ChatGPT Persona Voice](https://github.com/miuuyy/ChatGPT-Persona-Voice)**, a local
> app that changes the ChatGPT/Codex voice in near real time. It never touches your account, browser
> session, or ChatGPT requests, so using it carries no account-blocking risk. If you like my work,
> give it a try.

## Highlights

- **Native Codex models.** ChatGPT Web runs from Codex's model picker while the original task UI,
  context lifecycle, streaming, tracing, and tool presentation stay intact.
- **The full Codex harness over MCP.** Full mode gives every effort exposed by the signed-in account,
  including Pro, the active task's filesystem, shell, images, approvals, and configured tools/apps.
- **Continuous task sessions and native compaction.** Sequential messages reuse one task-bound
  regular chat. For non-Pro models, at the context boundary the retained agent writes a checkpoint before Codex
  starts a clean chat; if that chat was closed, canonical Codex history supplies the fallback.
- **One cross-platform launcher.** The macOS, Windows, and Linux app owns sign-in, model setup, MCP
  guidance, health checks, safe diagnostics, and up to five visible task-bound browser tabs.
- **Fail-closed behavior.** Missing models, tools, or changed ChatGPT UI produce explicit errors
  instead of silently switching route or capability. End-to-end coverage is documented in
  [release validation](docs/release-validation.md).

This build always opens regular chats and leaves the account's personalization setting unchanged.
Chats use your existing ChatGPT history settings. Prompts are still processed by OpenAI.
This project is unofficial; users remain responsible for applicable OpenAI terms and workspace policies.

## Quick start

Install or update the desktop launcher. To update or repair an existing installation, quit the
launcher and run the same command again; it replaces the application and embedded runtime while
preserving the ChatGPT profile and launcher configuration.

**macOS or Linux**

```bash
curl -fsSL https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.sh | sh
```

**Windows PowerShell**

```powershell
irm https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.ps1 | iex
```

Then complete the three checks in the app:

1. Sign in directly in the launcher's embedded ChatGPT browser. Login pages and identity-provider
   windows stay inside the same launcher-owned private browser profile; no session is copied between
   browsers.
2. Run the browser smoke test.
3. Press **Install models**, restart Codex once, and select a **ChatGPT Web — …** model.

The launcher detects the current account's ChatGPT controls during setup: Free/Go accounts expose
only Luna, while Pro appears only when the signed-in account exposes it. The separate **MCP** page
is optional and guides the full-harness setup without terminal commands.

The packaged launcher keeps sign-in and ChatGPT model turns in its embedded browser. It needs no
model API key, installed Chrome/Chromium, system Node/Bun, or project-managed browser download.

**Run from source**

```bash
git clone https://github.com/miuuyy/codex-chatgpt-web.git && \
cd codex-chatgpt-web && \
bun run app
```

This source path requires Bun 1.4.0. The command installs locked dependencies and opens the app.

## Modes

| Mode | Models | Local Codex tools | Extra setup |
| --- | --- | --- | --- |
| **Browser-only** | Free/Go: Luna; Plus: Instant–High; Pro: adds Extra High and Pro | No; Codex shows a warning | None |
| **Full harness (With Automation)** | Free/Go: Luna; Plus: Instant–High; Pro: adds Extra High and Pro | Yes for every listed effort, including Pro | OpenAI tunnel + ChatGPT connector |
| **Zero Risk** | Choose the ChatGPT model and effort manually; optional Pro-sized context | Yes; the full turn-bound Codex harness remains available | Separate OpenAI tunnel + `Codex Zero Risk` connector; paste and send manually |

Each automatic picker entry has one fixed ChatGPT mode. Codex still displays its built-in Effort and
Speed rows, but changing them cannot silently change the selected browser model. In automatic Full
mode every available effort receives the same turn-bound MCP capability. Pro has no separate
restriction or reduced tool contract.

Zero Risk keeps the local Responses bridge and full Codex harness, but never reads or changes the
ChatGPT page and never sends a prompt for you. The launcher prepares and copies the prompt; you
choose the model, effort, and `Codex Zero Risk` connector, then paste and send it yourself. This
removes the account risk specifically associated with ChatGPT web automation.

## Full harness

Full mode connects ChatGPT's tool calls back to the current Codex task through the official
[OpenAI tunnel-client](https://github.com/openai/tunnel-client). The tunnel is outbound: it does
not expose a public IP, open an inbound port, or require router forwarding.

The launcher's **MCP** page guides the complete setup. For the exact clicks, see the
[video walkthroughs](TROUBLESHOOTING.md).

> **Limits**
>
> See [Limits](https://github.com/miuuyy/codex-chatgpt-web/discussions/309) for the current
> ChatGPT message allowances for **GPT-5.6 Sol Pro** and **GPT-6 Astra**. Context limits depend on
> the account type and selected effort. Plus Medium/High uses a measured 90,000-token window, or
> up to 270,000 tokens with experimental **3× context** enabled, with native Codex compaction
> supported for non-Pro models. Pro never uses multipart delivery or Codex compaction in this build.

1. Finish the required setup, open **MCP**, create the Tunnel and regular API key, then press
   **Connect harness**.
2. Enable ChatGPT **Developer Mode** and create a new Tunnel connector named exactly
   **Codex Native2**, with **Authentication: None** and **Allow all actions**.
3. Run **Verify runtime** to confirm that **Codex Native2** is attached and available.

Write/modify actions also require the ChatGPT workspace and its administrator policy to permit
them. See
[developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
Unexpected approval prompts fail closed unless `--auto-approve-tool-calls` is explicitly enabled;
that option clicks **Allow once**, never a permanent grant.

## Operations

Use **Activity** for safe local diagnostics and **Settings → Run doctor** for end-to-end health.
Settings can also cancel a retained browser turn or remove the Codex integration before uninstall.
Set `CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS=1` only when every browser checkpoint needs a screenshot.

New installs use **Compatibility V1** for cross-backend subagents. **Native** preserves Codex's own
feature settings and enables plaintext Web-to-Web V2 delegation. Restart Codex and start a new task
after changing the protocol:

```bash
codex-chatgpt-web subagents status
codex-chatgpt-web subagents compatibility-v1
codex-chatgpt-web subagents native
```

## Limitations and security

- This is unofficial browser automation, not an OpenAI API. ChatGPT UI changes can break selectors;
  drift fails explicitly instead of silently switching model or transport.
- Browser state is a sensitive login artifact, and the loopback listener is reachable by processes
  running as the same local user. Never share the launcher profile; use a trusted workstation.
- Release packages currently target macOS 13+ (arm64/x64), Windows x64, and Linux x64. Runtime,
  tests, and packaging are gated on all three in CI; account-bound browser and MCP flows use the
  separate [release validation](docs/release-validation.md).
- Builds are not yet platform-signed, so Gatekeeper or SmartScreen may warn. The installers verify
  the published SHA-256 manifest before installation.

Read the complete [architecture](docs/architecture.md) and
[security model](docs/security-model.md) before enabling full mode. Report vulnerabilities through
[SECURITY.md](SECURITY.md).

## Development

```bash
bun run app
bun run dev:launcher
bun run src/cli.ts dev status
bun run dev:chat compaction-lab "Reply with exactly: DEV READY"
bun run verify
bun run smoke:subagents
bun run app:package
```

`dev:launcher` starts a second launcher profile under `~/.codex-chatgpt-web-dev`: separate Electron
state, browser cookies/login, ChatGPT account, configuration, sandboxed `CODEX_HOME`, chats,
diagnostics, broker, and tunnel profile. It can run beside the normal launcher and never starts a
Responses daemon or changes Codex. Optional Full setup starts and supervises only its isolated MCP
tunnel, using the distinct ChatGPT connector name `Codex Native2 DEV`.

`dev:chat` is a named, persistent synthetic outer-Codex harness. It executes the current working
tree through that isolated launcher browser, regular chat, prompt compiler, Responses parser, and
compaction handlers. Optional Full setup also exercises the MCP connector and broker; tool effects
are explicit simulation receipts. Browser-only chats expose no outer tools. It does
not open a Responses listener, change `openai_base_url`, stop the live daemon, or claim port 17841.
Run it without a message for `/status`, `/fill 30000`, `/compact`, `/model`, and `/reset` commands.
Sign in and initialize the profile once inside the window labelled **DEV**. Configure optional Full
harness only for simulated tool rounds; its launcher keeps the DEV tunnel ready while named chats
attach their broker on demand. Production credentials and the `Codex Native2` connector are never
reused implicitly. See
[DEV chat harness](docs/dev-chat.md).

- [Architecture](docs/architecture.md)
- [DEV chat harness](docs/dev-chat.md)
- [Security model](docs/security-model.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md)

## Star History

<a href="https://www.star-history.com/?repos=miuuyy%2Fcodex-chatgpt-web&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=miuuyy/codex-chatgpt-web&type=date&theme=dark&legend=top-left&sealed_token=hBVvg_eOjfMFDrfyeo5FPQkIwcvBEmXc6F7ZoOKnfFE4KPCs67o34w4XwVuM-bHGnKR-SKCAN_TSTWrzuqSBNU-RjNZCLT4f-xNs9qcDhciQtemxHKuuFj0N5YNqZIihdaQfakrh2ANhOrvP0K2LmLXX2zbsYyVaYZknyTnlYeIS_mOGvMcO32ZmPCHK">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=miuuyy/codex-chatgpt-web&type=date&legend=top-left&sealed_token=hBVvg_eOjfMFDrfyeo5FPQkIwcvBEmXc6F7ZoOKnfFE4KPCs67o34w4XwVuM-bHGnKR-SKCAN_TSTWrzuqSBNU-RjNZCLT4f-xNs9qcDhciQtemxHKuuFj0N5YNqZIihdaQfakrh2ANhOrvP0K2LmLXX2zbsYyVaYZknyTnlYeIS_mOGvMcO32ZmPCHK">
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=miuuyy/codex-chatgpt-web&type=date&legend=top-left&sealed_token=hBVvg_eOjfMFDrfyeo5FPQkIwcvBEmXc6F7ZoOKnfFE4KPCs67o34w4XwVuM-bHGnKR-SKCAN_TSTWrzuqSBNU-RjNZCLT4f-xNs9qcDhciQtemxHKuuFj0N5YNqZIihdaQfakrh2ANhOrvP0K2LmLXX2zbsYyVaYZknyTnlYeIS_mOGvMcO32ZmPCHK">
  </picture>
</a>

## Disclaimer

This is independent software and is not affiliated with or endorsed by OpenAI. Use it only with
your own account and in accordance with applicable [Terms of Use](https://openai.com/policies/terms-of-use/)
and workspace policies; it does not bypass authentication or access controls.

Having trouble? See [Troubleshooting](TROUBLESHOOTING.md) for common problems and their solutions.
