# ADR-0008: Bound same-task failure recovery and preserve a verified pause

Date: 2026-09-13. Status: Accepted. Build: `5.0.7-pro-context.5`.

## Context and authority

The operator requested automatic continuation of long Pro tasks without the prior 60-minute
requirement, then explicitly selected **up to five automatic continuations**. This amends
[ADR-0007](0007-thinking-failure-continuation.md); its stable native owner, atomic tool-capability
rotation, no-replay policy and short continuation prompt remain in force.

Read-only investigation of three `.4` failures found accepted-response durations of 48m14.666s,
52m11.860s and 63m11.041s. The first two were excluded by the hour gate. The third reached recovery
but failed the whole-URL equality check before sending a continuation. All three failure snapshots
still showed a rendered Stop button. `.4` released each chat, so subsequent manual Continue could
not reuse it. The redacted snapshots do not contain the exact URLs, and Stop was not observed after
release; neither the precise live URL change nor its eventual disappearance is established.

A production-worker reproduction demonstrated that adding a fragment to the same bound chat
triggers the old URL guard. A second isolated variation showed a lingering Stop prevents tool
settlement from reaching continuation; the unchanged-URL/no-Stop control continued. Task
coordination did not itself reproduce a second browser submission or an adapter crash. Logs
showed no overlapping browser lease at these failures. The upstream Thinking failed cause and
any contribution from cross-task coordination or large tool output remain unknown.

Private evidence identifier: `failure-investigation-20260913`; manifest SHA-256
`bb24dbd8622442fdd8cd8c69dd5967920d3f0963f2291939d52faf4bf1f434d2`.
Raw task content and operational logs remain outside version control. Reproducible checks and
current results are recorded in the [validation receipt](../bounded-recovery-validation.md).

## Alternatives and evaluation

| Decision | Alternatives compared | Selected rationale and cost |
| --- | --- | --- |
| Retry policy | Hour gate; unlimited retries; fixed finite budget with delay | Five attempts is the explicit operator choice. Delays of 5/10/20/40/60 seconds avoid rapid repeated submissions; these exact delays are provisional tuning, not a measured service optimum. |
| Conversation identity | Whole-URL equality; canonical URL equality; leased document and current message proof | URLs can change while a conversation is initially saved. A per-document nonce plus the accepted latest user and exact current response admits this case while rejecting replacement or new messages. |
| Lingering generation | Wait only; regenerate; stop the verified failed generation once | Waiting alone reproduced a stall. Stop releases the failed generation; regeneration would repeat its input. Existing authorized tools must still settle before rotation or pause. |
| Exhaustion | Close the chat; report success; retain a verified stopped chat while failing the native turn | Closing reproduces unusable manual Continue. Retention preserves Web memory without claiming that the task completed. Ambiguous failures are not marked resumable. |
| Recovery scope | Retry generic errors; rebuild from native history; explicit bound Thinking failed only | Reusing the observed conversation and settled execution journal avoids adding replay or new-context behavior. Healthy long responses remain untouched. |

The test matrix holds the response/task fixed and varies duration, response count, URL decoration,
document replacement, message identity, lingering Stop, failure-label removal, pending tools,
cancellation and mutation uncertainty. The actual worker loop executes against controlled DOM and
browser fixtures; the identity evaluator runs against DOM nodes. Actual helper subprocesses,
broker sockets and the native adapter test IPC, owner rotation and manual resumption. Launcher
tests independently check exact-key/connector reuse and release on cancellation. These establish
local state-machine behavior, not authenticated-service reliability.

## Recovery lifecycle and governing components

1. [Policy](../../src/adapters/chatgpt-web/thinking-failure-continuation.ts) counts unique failed
   responses within one browser/native turn. Any nonnegative elapsed duration is eligible.
   Submission acceptance resets the diagnostic clock, not the counter. The helper client also
   enforces sequential attempt numbers and duplicate response rejection; an atomic broker race
   returning no prompt may retry the same attempt after a fresh audit.
2. [Worker](../../src/adapters/chatgpt-web/browser-worker.ts) captures an ephemeral nonce in the
   accepted document. Recovery requires that nonce, a regular ChatGPT URL, the accepted latest
   user, a unique current response and matching outer turn containers. Older history hydration
   is allowed. A same-page CDP observation rebind retains the nonce; reload/navigation does not.
   Each recovery mutation is preceded by an identity/abort/deadline check. No chat is reloaded or
   reopened to satisfy that check.
3. After the bounded delay, a 120-second settlement stage acknowledges each already-authorized
   native batch at most once. If Stop remains on the confirmed failed generation, it clicks once,
   then waits for disappearance. Only this owned stop allows the failure label to become Stopped
   thinking or disappear. An external stop, missing response or ambiguous click/send ends recovery.
4. Outstanding native work and surrounding MCP activity must settle. A fresh broker revision must
   still match at capability rotation. The short prompt and fresh token then cross the existing
   [helper IPC](../../src/adapters/chatgpt-web/launcher-helper-client.ts). Late old-token requests
   are rejected by the unchanged [broker](../../src/adapters/chatgpt-web/turn-broker.ts). Model,
   effort and connector are retained; original prompts, tool requests and history are not replayed.
5. Each new response resets only its DOM/Markdown/completion trackers. Already delivered prose
   survives even if the failure UI clears its projection. The final text equals the append-only
   native stream. Cancellation and configured deadlines remain effective during delays and checks.
6. If the fifth continuation also fails, the same settlement/identity checks run. A successful
   broker completion fence closes the old capability against late calls. The worker raises the
   non-retryable `chatgpt_thinking_failed_paused` error and explicitly requests retention.
   [BrowserHost](../../launcher/electron/browser-host.cjs) leaves this chat ready for reuse, logs
   `browser.tab_failed_retained` and preserves the failure message; it never reports task completion.
   A new explicit user instruction must reuse the exact key/connector and creates a fresh native
   owner with a new retry budget. Unbound, cancelled and ordinary failed turns still release.

This is one failure-recovery lifecycle; no dependency, persistent retry scheduler, alternate
executor or task-to-task messaging mechanism is introduced. Pro compaction, multipart/staging,
manual Zero Risk, maintenance and Luna checkpoint capture retain their existing restrictions.

## Tradeoffs, limitations and validation plan

Up to five extra Web turns may be consumed per native turn. The delays are bounded and can be
revised from future operational evidence. They do not guarantee that ChatGPT will resume hidden
reasoning; the prompt asks it to inspect visible work and running jobs. Settled shell invocations
can leave background jobs running. No transport replay does not guarantee the model will avoid
choosing semantically duplicate work, which is why the prompt explicitly asks for inspection.

Retained pauses share the existing 30-minute idle expiry and five-tab capacity. App restart,
closing/evicting the tab, lost document identity, unresolved tools or uncertain sends can still
prevent resumption. Chats released by earlier builds cannot be recovered by this change.

An authenticated long Pro failure is not forced by the local tests. After manual installation,
the next naturally occurring failure should be checked for: attempt count, exact response binding,
one stop at most, settled native/MCP activity, fresh token rejection of old claims, accepted
continuation, and retained manual resumption if all five fail. This is an outstanding service
acceptance check, not a reason to infer a ChatGPT-side fix or a cross-task interaction cause.

History: `.4` introduced duration-gated recovery; `.5` replaces that gate and repairs recovery
identity, terminal generation cleanup and verified retention under the operator's new limit.
