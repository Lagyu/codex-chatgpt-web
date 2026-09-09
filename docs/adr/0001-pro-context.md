# 0001: Use retained ChatGPT context for Pro

Date: 2026-09-10. Status: accepted. Governs `chatgpt-web/pro`, `chatgpt-web/zero-risk-pro`,
and their internal backend routes. A Pro subscription alone does not change other efforts.

## Context and inspected architecture

The existing Responses bridge parses Codex history, expands `previous_response_id` from a local
cache, and routes model calls to an adapter. The adapter already owns a task-bound browser lease
and a live MCP broker. Multiple Responses requests can deliver tool calls and results while that
one browser assistant response remains running. The Launcher already supports retained tab reuse,
an incremental resume prompt, and a required-retention lease flag. Non-Pro compaction can instead
summarize the retained response, reconstruct context, or use a new browser chat. Bigger Context
can submit multiple stages. Those defaults conflict with the requested Pro behavior.

The constraint is one submitted Web user message per native Codex turn, with all of that turn's
tool work inside one Web assistant response. The retained Web chat is the only model memory;
local transcripts, summaries, or tool receipts must never reconstruct that memory.

## Alternatives and evaluation

| Alternative | Evaluation | Decision |
| --- | --- | --- |
| Keep full-history prompts and disable only explicit compaction | The cached Responses path, fallback prompt, and browser recovery still reconstruct context. | Rejected. |
| Clear only `auto_compact_token_limit` | Codex derives a threshold from either context-window field. Source inspection shows this still compacts. | Rejected. |
| Publish enormous windows or zero token usage | Obscures real limits and does not actually remove the scheduler's context budget. | Rejected. |
| Fork Codex or add a separate Pro executor | Duplicates working lease, streaming, tool, and ownership infrastructure; not necessary for supported clients without context overrides. | Rejected. |
| Add a Pro policy around the existing lease and broker | Supports incremental input and history-free tool-result deltas while keeping the existing execution path. | Selected. |

Comparisons use identical synthetic inputs and controlled changes to model selection, local-tool
availability, and catalog compaction fields. No latency or capacity claim is inferred from mocked
ChatGPT responses. Source inspection complements executable tests; it does not replace them.

## Implementation

The no-Pro-staging rule also applies when a non-Pro transaction would otherwise promote an
oversized staging message to Pro. Staging selection and both payload planners now allow only
non-Pro efforts, and multipart preflight rejects an explicit Pro staging effort. Keeping that
fallback would violate the no-staging requirement even though the selected final model was not
Pro. Large non-Pro records must fit a non-Pro staging message; ordinary non-Pro context management
continues. The existing staging-selection regression compares small non-Pro stages with the
previous Pro-only oversized case, which now fails before submission.

`pro-context.ts` projects only the newest native user/parent instruction into subsequent prompts.
A new task may include its initial system/developer/environment instructions in the same first
message. Existing historical tasks cannot bootstrap a fresh Pro chat. Attachments come from the
selected input. The Web conversation key ignores Codex compaction epochs for Pro.

The execution key is native thread plus turn identity, independently of history and request IDs.
Live tool-result deltas therefore reach the same broker without reconstituting the original
request. New instructions under the same turn ID cannot start a second Web response. New native
turns use the retained tab and the new instruction only. Automatic and manual launch paths fail
before submitting or copying a prompt when a required retained chat is missing.

The Pro Responses route does not read or populate the previous-response transcript cache.
Model metadata clears `context_window`, `max_context_window`, and `auto_compact_token_limit`;
inherited token-budget guidance is removed. Both explicit compaction endpoints reject Pro.
Usage continues to report an estimate of the actual new input; a large MCP result does not become
the next browser prompt or a local context-budget signal. Physical single-message limits remain
enforced. Bigger Context is ignored for Pro, and the compiler and worker also reject staged
payloads directly. Browser observation and connector-refresh recovery are disabled for Pro.

Content-free submission tombstones persist hashed native thread/turn identity beside the Launcher
descriptor. They are claimed before starting a response and have no automatic expiry. They prevent
duplicate submission after daemon restart, failed initialization, or in-memory session expiry.
Corrupt identity state fails closed. This uses the existing atomic, owner-only file writer and
the application's single-daemon ownership model; no new database or dependency is introduced.

The broker still needs authenticated filesystem permissions, tool definitions, pending call IDs,
and delivery acknowledgements. These are execution authority and transport state, not model
context. Pro may reuse already authenticated same-thread permissions, but cannot recover them
from rollouts, parent transcripts, or compaction summaries. An HTTP reconnect may redeliver an
already-recorded outbound event to Codex; it never submits history or an extra message to ChatGPT.

## Validation and reproducibility

Run `bun test tests/pro-context.test.ts`, the existing harness/prompt/catalog/worker suites,
`bun run launcher:test`, and `bun run verify`. Run `bun run smoke:pro /absolute/path/to/codex`
for the installed-client experiment. It creates isolated temporary application and Codex homes,
uses a loopback provider and a test-only API key, and removes them when finished.

Observed policy tests cover initial-instruction preservation, exclusion of old assistant/tool
content, image preservation, both Pro selections, no staging with Bigger Context enabled,
non-Pro history retention as a control, required tab ownership, restart tombstones, Responses
cache bypass, and terminal HTTP errors before opening SSE. Two MCP rounds with large synthetic
tool results run through the actual broker with one Web-response invocation and unchanged
new-message usage.

Installed Codex `0.153.4` executed two real local shell commands through the broker: three HTTP
Responses requests, one simulated Web assistant response, and no compaction. The stress harness
reports 9,000,000 input tokens after each tool boundary only in the test. The comparison changes
the same catalog row to a numeric context/compaction budget; this probes the actual native
scheduler rather than merely comparing JavaScript constants. The numeric control attempted six
compactions, all rejected before any additional Web response. See the
[validation receipt](../pro-context-validation.md) for the completed comparison and full-suite counts.

Three pre-existing non-Pro stress fixtures exceeded their 20-second, 5-second, and 30-second
timeouts during the full run (33.6, 5.1, and 43.7 seconds) without assertion failures. Their correctness
assertions are unchanged; explicit budgets of 60, 15, and 90 seconds keep large tokenization fixtures bounded
without treating build-host throughput as a product requirement.

## Tradeoffs and limitations

Losing, navigating away from, closing, or evicting a retained conversation cannot be repaired from
Codex history. A lost in-flight response cannot resume its local tool work. Start a new Codex task
when continuity is unavailable. The inherited Launcher lifetime remains unchanged: retained tabs
expire after 30 idle minutes and may be evicted at the five-tab capacity. Both end Pro continuity;
keeping these policies avoids expanding this change into browser resource management. A failed
initial attempt also consumes its native turn ID; this
intentionally favors at-most-once submission over automatic retry. Stop/abort cleanup remains
available. Do not delete submission identities to recover a task.

This does not disable ChatGPT's own internal context management. Native Codex still maintains its
task display and tool lifecycle; those records are not sent back as Pro model context. The initial
message and each new message must fit the real browser transport boundary.

Codex applies explicit `model_context_window` and `model_auto_compact_token_limit` overrides after
loading model metadata. These must be absent from the active config/profile/CLI for Pro's native
automatic-compaction scheduler to remain disabled. This build does not rewrite global settings,
which would affect native and non-Pro models. Explicit compaction attempts fail instead of
reconstructing Pro context. Future clients must repeat the native smoke when their model metadata
or compaction contracts change.

The native smoke simulates the Web assistant, while running the installed Codex CLI, real local
commands, bridge, and broker. It does not validate an authenticated live Pro response, account
availability, or the current production ChatGPT DOM. Existing launcher/worker fixtures cover the
lease and submission contracts. A separate authenticated profile is needed for that remaining
live-service check; replacing the running application is not part of producing this installer.

## Sources and related components

- Upstream base: <https://github.com/miuuyy/codex-chatgpt-web/commit/e85e3693fdb4e3e033348c08df0298c20fcdb612>.
- Codex `ModelInfo::auto_compact_token_limit` and resolved context window:
  <https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs> (inspected 2026-09-10).
- Codex configuration precedence, `with_config_overrides`:
  <https://github.com/openai/codex/blob/main/codex-rs/models-manager/src/model_info.rs> (inspected 2026-09-10).
- [Architecture](../architecture.md), [policy](../../src/adapters/chatgpt-web/pro-context.ts),
  [adapter](../../src/adapters/chatgpt-web/index.ts), [native smoke](../../scripts/smoke-codex-pro-context.ts),
  [regressions](../../tests/pro-context.test.ts), [launcher tests](../../launcher/tests/browser-host.test.cjs).

History: initial decision introduced in `5.0.7-pro-context.1`; no earlier decision superseded.
