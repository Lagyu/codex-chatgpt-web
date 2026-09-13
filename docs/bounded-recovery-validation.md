# Bounded failure recovery validation

Build: `5.0.7-pro-context.5`. Governing decision: [ADR-0008](adr/0008-bounded-failure-recovery.md).

## Scope and reproducibility

Run from the repository root with Bun 1.4.0 and the installed native Codex executable:

```sh
bun test tests/thinking-failure-continuation.test.ts tests/launcher-helper-client.test.ts tests/pro-context.test.ts tests/regular-chat-and-failure.test.ts tests/launcher-browser-host.test.ts
node --test launcher/tests/browser-host.test.cjs
bun run verify
bun run smoke:pro /absolute/path/to/codex
bun run app:package
bun run app:smoke
```

Long verification/package jobs use a one-shot LaunchAgent with `KeepAlive=false`, persistent
stdout/stderr, per-command logs, an exit-code file and final lifecycle verification. No installed
app is replaced or restarted; packaged smoke uses an isolated profile.

## Completed results

Validation finished on 2026-09-13 with Bun 1.4.0, native `codex-cli 0.153.4`, and macOS arm64.

| Check | Result |
| --- | --- |
| Focused worker, DOM, helper, adapter and launcher regressions | Passed; all final cases also included in the full suites below |
| Root tests | 756 passed, 1 platform skip; 3,779 assertions |
| Launcher tests | 302 passed, 1 platform skip |
| Root and launcher dependency audits | No vulnerabilities found; 106 and 351 packages checked |
| Version checks and both TypeScript checks | Passed |
| Renderer build, runtime bundle and license generation | Passed |
| Relocatable runtime smoke | `RELOCATABLE_RUNTIME_SMOKE_OK` |
| Native Pro context smoke | Two real native shell calls across three Responses requests in one Web response, no compaction; positive control still triggers compaction and fails as expected |
| macOS arm64 DMG and ZIP | Built successfully, ad hoc signed |
| Isolated packaged launcher smoke | `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64` |
| One-shot job lifecycle | Exit code 0, `KeepAlive=false`, verified stopped, unloaded and plist archived |

Private evidence identifier: `bounded-recovery-20260913-175240`. Its manifest records source
hashes for the 14 changed implementation/test/version files, per-check logs, lifecycle evidence
and artifact hashes. Manifest SHA-256:
`94479a1f3b5407784d344096911985a5199d9a50e775771d28fc673f4e0e8cd3`.
The artifacts remain ignored under `launcher/artifacts/`; the previous `.4` installers were
preserved in the evidence directory before packaging.

| Artifact | SHA-256 |
| --- | --- |
| `codex-web-gpt-5.0.7-pro-context.5-mac-arm64.dmg` | `c9ee7fa185dabd1c18e0c86b05980956c54c53efc003ee91dcc88a99bca32722` |
| `codex-web-gpt-5.0.7-pro-context.5-mac-arm64.zip` | `e8de5a4571ca073c4acab4b7586bbb8744a890e6846173b9b8a5ed0b6684c604` |

## Controlled regression matrix

| Variation | Required outcome |
| --- | --- |
| No accepted response; duplicate identity; invalid duration/attempt | No new authorized continuation |
| 0ms, short failure, hour boundary, long failure | Eligible with no minimum duration |
| Short failure after long failure | Eligible within the same five-attempt budget |
| Fifth continuation succeeds | Normal completion; six total accepted Web submissions |
| Sixth failed response (five continuations used) | No seventh submission; settle and retain a failed native turn |
| Same document, query/hash change or initial saved URL promotion | Continue using exact current message identity |
| Reload, new messages, missing/duplicate response, wrong origin or temporary chat | No continuation |
| Older DOM history hydrates | Preserve current response continuity |
| Lingering Stop; owned stop removes/relabels failure | Click once, wait until stopped, then continue |
| Stop remains; click uncertain; external stop | No continuation and no verified pause |
| Existing pending tool batch or late broker activity | Settle once; re-audit revision; never replay a tool request |
| Old token/binding after rotation or terminal pause | Reject; other task's owner remains valid |
| Failure UI clears prior prose | Preserve the exact native output stream |
| Cancellation before/during delay, settlement or effort selection | No continuation submission |
| Send acceptance uncertain | Never resend automatically |
| Helper malformed, duplicate, out-of-order or sixth request | Reject through real helper IPC |
| Exhausted task followed by explicit Continue | Same retained key, new native owner; no original-history replay |
| Cancelled/unbound/default failed tab | Release rather than promise resumption |

The prior `.4` investigation reproduced whole-URL rejection and wait-only Stop deadlock with an
unchanged-URL/no-Stop control. Its private evidence manifest is referenced in ADR-0008. These
tests repair those local failure paths; the precise upstream Thinking failed cause is unknown.

## Acceptance boundary

Authenticated ChatGPT failures were not forced, and no paid Pro continuation was sent for this
validation. Browser/response fixtures do not reproduce all live UI hydration and service timing.
The next natural failure after installation remains the live acceptance check. Native Codex
smoke uses a simulated Web response with real Codex and broker execution. macOS arm64 is the
packaged target; notarization and Windows/Linux builds are outside this local validation.
