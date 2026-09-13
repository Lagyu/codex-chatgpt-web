# Long Thinking failed continuation: validation

Build: `5.0.7-pro-context.4`, macOS arm64, 2026-09-13.
Decision: [ADR-0007](adr/0007-thinking-failure-continuation.md).

## Controlled experiments

The focused command passed 60 tests across four files:

```sh
bun test tests/thinking-failure-continuation.test.ts tests/regular-chat-and-failure.test.ts tests/pro-context.test.ts tests/launcher-helper-client.test.ts
```

| Comparison | Observed result |
| --- | --- |
| No accepted submission, one millisecond before 60 minutes, exactly 60 minutes | No continuation |
| Failed response at 60 minutes plus one millisecond | Eligible for same-conversation continuation |
| Long failure, then a 10-second failed continuation | One continuation; the second failure ends the task |
| Two independently long failures, then success | Two continuations, one browser page, three response identities, correct complete streamed answer |
| Existing tool batch waiting for DOM acknowledgement | Acknowledged and settled before continuation preparation |
| Delivered native result with an outstanding MCP activity | Rotation remains unavailable until the activity settles |
| Activity races with the audited broker revision | Old revision rejected; a fresh audit is required |
| Previous model token or binding after rotation | New claims and invocations rejected; native owner remains live |
| Multiple rotations, completion and revocation | One active alias per owner; aliases removed on revocation; stale revisions cannot complete the task |
| Same native Pro task across the failure | Original tool executes once, continuation issues a different tool, history-free Responses deltas reach the same owner |
| Actual helper subprocess and production IPC | Prompt and revision preserved; a raced audit can return no prompt; duplicate, short and canceled requests stop |
| Changed conversation, cancellation, unsettled activity, ambiguous send | No additional accepted submission; an ambiguous send is attempted only once |
| Maintenance, compaction and generic errors | No automatic continuation |

The worker tests use the production observation and recovery loop with simulated page methods and
an injected monotonic clock. The broker tests use actual local socket traffic. The helper tests
run both production IPC endpoints in separate processes, substituting only browser behavior.
The native adapter test executes its real session and broker logic with synthetic browser calls.
These prove local contracts; they do not establish ChatGPT service reliability.

The first worker experiment exposed an old-tool revision being observed again after tracker reset,
which incorrectly treated the new final answer as pre-tool text. Carrying the settled revision
forward fixed the hang; the two-continuation test now proves the final answer can finish. Two
fixture setup issues were also corrected: an overlong macOS socket path and a missing helper prompt
selection acknowledgement. No correctness assertion or test deadline was relaxed.

## Full verification

| Check | Result |
| --- | --- |
| `bun run verify` | Passed |
| Root dependency audit | No vulnerabilities, 106 packages |
| Launcher dependency audit | No vulnerabilities, 351 packages |
| Root tests | 738 passed, 1 platform-specific skip, 0 failed; 739 tests across 53 files |
| Launcher tests | 300 passed, 1 platform-specific skip, 0 failed; 301 tests |
| Root and launcher type checks, renderer build | Passed |
| Relocatable runtime | `RELOCATABLE_RUNTIME_SMOKE_OK` |
| `bun run smoke:pro /absolute/path/to/codex` | `NATIVE_CODEX_PRO_CONTEXT_SMOKE_OK` |
| `bun run app:package` | macOS arm64 ZIP and DMG built; deep strict signature and runtime manifest validation passed |
| `bun run app:smoke` | `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64` |

The native smoke used the installed Codex CLI and real local commands. The retained-context case
completed two commands with three Responses requests, one simulated Web response and no
compaction. The numeric-budget control attempted six rejected compactions and did not submit a
second Web response. Healthy-turn behavior is unchanged. Neither case spends a live Pro turn.

The verification and packaging job runs as a one-shot LaunchAgent with `KeepAlive=false`,
persistent stage logs, and a durable exit status. Evidence directory:
`output/thinking-continuation-20260913-094719/` (ignored). Previous `.3` installer assets were copied
there before packaging, and the `.3` receipt's DMG checksum transcription was corrected against
the actual asset.
The job exited successfully after one run, and its LaunchAgent was unloaded and archived.
`evidence-manifest.json` binds the durable status and four stage logs with SHA-256; its own digest is
`2b304fc832e1d0fb1d0bc19420bfd1642b9f5f986f468a36a8ea55483395800a`.

The package is ad-hoc signed for local use. Notarization was skipped because no notarization
credentials/options were configured. Windows, Linux and Intel macOS builds were not run.

```text
ade4a7446a42938e55ce297dc59c82ee1948d387195d8d0dfd2cbe2da3444696  codex-web-gpt-5.0.7-pro-context.4-mac-arm64.dmg
e40e3ce7e7d63292f8127b5fbb7bb4416436301ae84e5f014b4bf66124bd85cb  codex-web-gpt-5.0.7-pro-context.4-mac-arm64.zip
```

## Acceptance limits

A controlled authenticated response running for more than an hour and then displaying Thinking
failed was not forced. Therefore the full recovery sequence has not yet been observed against a
new live ChatGPT failure. The previous live DOM evidence remains recorded in the
[`.3` receipt](regular-chat-validation.md). The operator's installed application and live tasks
were not replaced, restarted or sent a new ChatGPT prompt during this change.

Each continuation may consume another ChatGPT turn. The elapsed-time gate limits retry frequency,
not total attempts; hidden reasoning is not recoverable. The same conversation and native owner
must remain available, and outstanding tools must settle within the 120-second window. Future
acceptance should inspect `responseElapsedMs` and `continuation accepted` after a naturally
occurring long failure, confirm the same conversation and native task, and check that any quick
subsequent failure ends with no further submission.
