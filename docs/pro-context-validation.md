# Pro retained context: local build validation

Build: `5.0.7-pro-context.1`, macOS arm64, 2026-09-10.
Source: branch `feat/pro-retained-context`, based on upstream
`e85e3693fdb4e3e033348c08df0298c20fcdb612` (`5.0.6`).
Decisions: [Pro context policy](adr/0001-pro-context.md) and
[build dependencies](adr/0002-build-dependencies.md).
The [packaged startup decision](adr/0003-packaged-startup.md) addresses a failure discovered
during the first isolated application launch.

## Environment and completed checks

The host reports macOS 26.5.1 (25F80), arm64. Development used Bun 1.4.0,
Node 24.14.1, and the installed Codex CLI 0.153.4. Packaging uses the repository's
Electron 41.10.7 and electron-builder 26.15.3.

| Check | Observed result |
| --- | --- |
| `bun run verify` | Passed, including version consistency, audits, both typechecks, tests, renderer build, notices, and relocatable runtime smoke |
| Core suite | 706 passed, 1 skipped, 0 failed; 707 tests in 51 files, 3,669 assertions |
| Launcher suite | 297 passed, 1 skipped, 0 failed; 298 tests after the startup regression was added |
| Root dependency audit | No vulnerabilities reported among 106 checked packages |
| Launcher dependency audit | No vulnerabilities reported among 351 checked packages |
| Relocatable runtime | `RELOCATABLE_RUNTIME_SMOKE_OK` |
| Installed Codex comparison | `NATIVE_CODEX_PRO_CONTEXT_SMOKE_OK`; details below |
| Signed application archive | `codesign --verify --deep --strict` and packaged runtime manifest verification passed |
| Final packaged startup | `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64`; final release job exited 0 |
| Disk image integrity | `hdiutil verify` passed |
| Packaged Pro policy | Both packaged entrypoints contain the no-Pro multipart guard and select only `low`/`medium` for staging |

The core skip is Windows-specific indexed-rollout path handling. The launcher skip is
Linux-specific AppImage process identity. Neither skipped case exercises the new Pro policy.
The aggregate automated suite result is 1,003 passes, two platform skips, and zero failures.

Three existing non-Pro tokenization stress tests initially exceeded their time budgets without
assertion failures. Only their timeouts were increased to 60, 15, and 90 seconds; their inputs and
correctness assertions remain unchanged. The final complete run passed. Localized README link
parity also exposed the missing translated Pro documentation, which was corrected before the
passing full launcher run.

The initial signed package passed archive integrity but failed the old 10-second idle-renderer
startup deadline. Its fatal dialog then blocked unattended exit. The bootstrap now allows one
60-second load attempt, smoke failures exit without a modal dialog, and the isolated process has
a hard 120-second deadline. A controlled 22-second renderer event fails under the old budget and
succeeds under the new default; a stalled case still fails at the new deadline. No retry was added.
The final complete source verification, native CLI comparison, fresh package build, signature
verification and isolated application smoke all subsequently passed in one release job.

## Verified artifacts

The binaries are ready for local installation on macOS Apple Silicon. Open the DMG and copy
`Codex Web GPT.app` into Applications after quitting the installed Launcher and Codex.

| Artifact | Size in bytes | SHA-256 |
| --- | ---: | --- |
| [DMG installer](../launcher/artifacts/codex-web-gpt-5.0.7-pro-context.1-mac-arm64.dmg) | 164,165,907 | `72154fe36e61c92a6ba651e1ba1fc837e5be7dc99503f1884bf2a5fd59bc5188` |
| [ZIP application](../launcher/artifacts/codex-web-gpt-5.0.7-pro-context.1-mac-arm64.zip) | 167,869,758 | `2803cc66c4b5a4643a617b68453ecc8e5846b5426c3a0bc910d814755ed133bf` |

[SHA256SUMS](../launcher/artifacts/SHA256SUMS) and the
[machine-readable validation record](../launcher/artifacts/build-validation.json) accompany the
binaries. Generated artifacts are not committed. The ZIP's runtime manifest exactly matches the
final build, with bundle ID
`5ab83981d4d9292b37bfbed5317f0641e131b85e3a973400db8cf0455d77ea1d`.

Persistent local evidence is archived under
`/Users/yuya/Library/Logs/codex-chatgpt-web-build/verified-5.0.7-pro-context.1-20260910-070741`.
It includes stdout/stderr, job scripts and exit status, LaunchAgent lifecycle evidence, the disk
image verification output, and the artifact metadata. Initial startup failure evidence remains
in the sibling `package-smoke-initial-failure` directory.

Reproduce from the repository with Bun 1.4.0 and Node 24.14.1 available on `PATH`:

```sh
bun install --frozen-lockfile
bun install --cwd launcher --frozen-lockfile
bun run verify
bun run smoke:pro
bun run app:package
bun run app:smoke
```

The native comparison additionally requires Codex CLI 0.153.4 on `PATH`. Long checks in this
session ran as one-shot LaunchAgents with `KeepAlive=false`, persistent logs, and observed exit
status. Code-signing/notarization and live-account limitations below still apply.

## Installed-client comparison

`bun run smoke:pro` runs the actual installed Codex CLI against an isolated loopback bridge and
the actual tool broker. It replaces the Web assistant with a deterministic fixture. Both cases
report 9,000,000 input tokens at native tool boundaries; only the catalog budget changes.

| Observation | Pro policy | Numeric-window control |
| --- | --- | --- |
| Context / maximum window | `null` / `null` | 1,000,000 / 1,000,000 |
| Automatic-compaction limit | `null` | 900,000 |
| CLI exit status | 0 | 1, expected after rejected compaction |
| Ordinary Responses requests | 3 | 1 |
| Compaction requests | 0 | 6, all rejected with HTTP 400 |
| Simulated Web assistant responses | 1 | 1 |
| Broker-completed native tool rounds | 2 | 0 |

The treatment executes real shell commands and checks their file output is exactly
`native-round-0\nnative-round-1\n`. The control counter describes completed broker rounds, not a
claim that no operating-system command began before Codex attempted compaction. Its six attempts
demonstrate that merely rejecting requests does not disable the native scheduler; the absent
catalog budget is necessary. No compaction attempt creates an additional Web response.

Separate bridge regressions check initial instructions, new-message-only continuations,
history-free tool-result deltas, two large-result MCP rounds inside one response, response-cache
bypass, persisted submission identities, missing-session errors before SSE, and manual retained
tab enforcement. Non-Pro context management remains covered by the existing regression suite.
The previous fallback that selected Pro solely for oversized non-Pro staging messages was also
removed; both planning and browser preflight enforce that restriction.

## Change inventory

| Area | Files and purpose |
| --- | --- |
| Central Pro policy | `src/adapters/chatgpt-web/pro-context.ts`: select new input, forbid compaction/reconstruction, persist only hashed submission identities |
| Responses and model metadata | `src/server.ts`, `src/model-catalog.ts`, `src/chatgpt-web-models.ts`, `src/types.ts`: bypass transcript caching and disable Pro's native context budget |
| Existing execution path | `src/adapters/chatgpt-web/index.ts`, `turn-execution.ts`, `conversation-key.ts`, `thread-environment.ts`: reuse one running response, exact retained conversation, authenticated tool authority |
| Browser transport | `src/adapters/chatgpt-web/browser-worker.ts`, `prompt.ts`, `usage.ts`: single-message input, no Pro staging, no browser recovery, incremental usage |
| Manual launcher path | `src/launcher-browser-host.ts`, `launcher/electron/control-server.cjs`, `launcher/electron/browser-host.cjs`: require the retained Pro tab before copying or opening a prompt |
| Packaged startup | `launcher/electron/browser-host.cjs`, `launcher/electron/main.cjs`, `launcher/scripts/smoke-package.cjs`: bound a cold renderer load and unattended failure without retries |
| Developer interface and UI | `src/dev-chat/driver.ts`, `src/dev-chat/cli.ts`, `launcher/src/i18n.ts`: disable Pro compaction controls and explain the policy |
| Tests and experiment | `tests/pro-context.test.ts`, `scripts/smoke-codex-pro-context.ts`, existing harness, catalog, server, prompt, usage, worker and launcher tests |
| Build | Root/launcher manifests and lockfiles, `src/version.ts`, `scripts/install.sh`: custom version and narrow Hono/js-yaml security fixes |
| Documentation | English/Japanese/Chinese READMEs, architecture, indexed ADRs, release validation, this receipt |

## Installation and operating limits

Quit the installed Launcher and Codex before replacing the app, then restart both and begin a new
Codex task with `chatgpt-web/pro` or `chatgpt-web/zero-risk-pro`. Remove active
`model_context_window` and `model_auto_compact_token_limit` overrides from the applicable
config/profile/CLI: Codex applies those after the catalog and can re-enable its scheduler.
Compaction requests still fail explicitly when an override is present.

Keep the exact retained ChatGPT tab available. Its loss, navigation, closure, existing 30-minute
idle expiry, or eviction at the five-tab capacity ends continuity. Failed attempts consume their
native turn ID; lost executions are not resubmitted. Same-turn steering cannot start another
assistant response; send new instructions in a new Codex turn. Each message must fit the browser's
single-message limit. Zero Risk Pro still requires the user to select Pro and submit the prompt
manually in the Launcher.

## Acceptance boundary

Authenticated live ChatGPT Pro plus MCP has not been exercised with this modified build. The
native CLI experiment proves real local command execution with a simulated browser response;
it does not validate current ChatGPT DOM behavior, account availability, or live connector routing.
ChatGPT's own internal context management is outside this change. Native Codex may retain its
local transcript for UI and tool execution; that transcript is not replayed as Pro model memory.

Windows/x64, Linux/x64, and macOS/x64 packages were not built. No public release was published and
the active production app was not replaced. The local macOS package uses ad-hoc signing;
Developer ID signing and Apple notarization are not claimed. Account-bound public-release gates
in [release validation](release-validation.md) remain unverified for this custom build.
