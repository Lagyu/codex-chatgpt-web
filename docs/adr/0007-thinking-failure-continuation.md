# ADR-0007: Continue a failed response only after more than 60 minutes

Date: 2026-09-13. Status: Accepted. Build: `5.0.7-pro-context.4`.

## Context and authorization

The operator observed another explicit Thinking failed in a regular chat on `.3`, roughly
89 minutes after accepted submission. The detector worked; the upstream cause remains unknown.
The operator requested automatic continuation with an individual response duration strictly
greater than 60 minutes, to prevent rapid failure loops. This explicitly amends the one-response
constraint in [ADR-0001](0001-pro-context.md) and terminal-only handling in
[ADR-0005](0005-thinking-failed.md). It does not authorize reconstructing model memory.

## Alternatives and evaluation

| Alternative | Assessment |
| --- | --- |
| Always fail, as in `.3` | Preserves at-most-once submission but loses the requested opportunity to finish long work. Retained for ineligible failures. |
| Retry all errors or use total native-task elapsed time | An early continuation failure inherits the original hour and can loop rapidly. Rejected. |
| Resend the original input or open a new chat | Reconstructs context, risks repeated work and loses retained-chat continuity. Rejected. |
| Continue in place with the previous tool capability | Delayed requests from the failed response can still use that capability. Rejected. |
| Continue in place after tool settlement and capability rotation | Reuses the native execution journal, preserves completed work, and rejects the old response's future tool requests. Selected. |
| Impose an additional total attempt cap | Bounds all attempts, but would stop later qualifying long responses. Not selected; the operator chose an individual duration gate. |

Controlled fixtures hold the original task, workspace and failure structure constant while
varying elapsed time, pending tool work, response identity, cancellation, and submission outcome.
They exercise the real worker loop, broker socket, launcher helper protocol and native Responses
adapter. Browser DOM and elapsed clocks are simulated; no service-reliability improvement is
inferred from these experiments. Results and reproducible commands are in the
[validation receipt](../thinking-continuation-validation.md).

## Decision and implementation

An accepted submission starts a monotonic elapsed timer. Only exact Thinking failed inside the
bound response can claim a continuation, and only when elapsed time is strictly greater than
3,600,000 ms. Exactly 60 minutes is ineligible. The claim is unique to the response identity.
Every accepted continuation resets the timer. Detection time is the available endpoint; an
unobservable browser cannot prove the precise upstream failure time.

Automatic launcher tasks must still own the same regular `/c/` conversation, with the failed
response present and generation stopped. Maintenance, manual Zero Risk, compaction, multipart
requests and Luna checkpoint capture are excluded. Existing task deadlines and cancellation
remain effective. Healthy long responses do not receive a continuation.

The worker waits at most 120 seconds for outstanding native calls and their surrounding MCP
activities to settle. A batch already waiting for its pre-dispatch answer observation is
acknowledged once using the failed response's DOM, allowing its already-authorized work to finish.
Both the external progress snapshot and an atomic broker revision audit must allow continuation.
A late activity invalidates the revision and forces another audit within the same settlement
budget. Unknown or unsettled execution state never grants a new capability.

The broker retains its stable native owner token, environment, pending native receiver, and
execution journal. In one synchronous operation it retires the prior model token and binding,
issues a fresh model token alias for the same owner, and increments the revision. Delayed old
claims and invocations are rejected; stale completion/rotation revisions cannot be reused.
Cancellation and completion revoke the alias as part of the original owner lifecycle. There is
one active alias per continued owner, with the existing bounded retired-handle history.

The daemon sends the short continuation and fresh capability through the existing helper IPC.
Both sides correlate requests, reject malformed or duplicate requests, and stop on cancellation.
The actual send has no automatic resubmission if acceptance is uncertain. The same model and
effort are selected, and the existing connector is reused without a catalog refresh or reload.

The continuation text is:

> Your previous response ended with "Thinking failed." Please continue the original task from this conversation and the current workspace. Check completed work and any running jobs before taking further actions, so nothing is duplicated. Then continue toward the original objective with the same freedom to explore deeply.

Tool-enabled tasks append the fresh tool token and a reminder to retain the existing instructions
and tool contract. No original instruction bundle, tool result, transcript or summary is added.
The prompt encourages broad completion without directing the model's substantive strategy.

Each new response receives fresh DOM, trace, Markdown and completion trackers. Settled old tool
batch revisions are carried forward without treating the new answer as pre-tool prose. Visible
partial prose is finalized and separated by a blank line; final returned text equals the
append-only native stream. The native task remains one live execution, even if multiple Web
responses are needed. Original submission tombstones remain claimed throughout.

## Tradeoffs and limitations

Every continuation can consume another ChatGPT turn. The duration gate bounds retry frequency,
not total attempts: repeated responses each longer than an hour may continue indefinitely until
completion, cancellation, a configured deadline or an ineligible failure. Background jobs already
launched by a settled tool may still be running, which is why the prompt asks the model to inspect
them. Transport at-most-once execution does not guarantee the model will never choose a
semantically duplicate command. Hidden reasoning cannot be recovered.

The upstream failure cause and reliability of the live service are not established. A controlled
live hour-long failure has not been forced. The native usage report remains an estimate of native
input, not a bill or measurement of ChatGPT continuation context. A changed conversation, lost
helper or daemon, malformed request, settlement failure or uncertain send still ends the task;
durable restart recovery is outside this decision.

## Governing components

- [Policy and prompt](../../src/adapters/chatgpt-web/thinking-failure-continuation.ts).
- [Worker](../../src/adapters/chatgpt-web/browser-worker.ts), [broker](../../src/adapters/chatgpt-web/turn-broker.ts),
  [adapter](../../src/adapters/chatgpt-web/index.ts), [helper client](../../src/adapters/chatgpt-web/launcher-helper-client.ts),
  [helper process](../../src/adapters/chatgpt-web/browser-helper-main.ts).
- [Timing, worker and broker tests](../../tests/thinking-failure-continuation.test.ts),
  [helper IPC tests](../../tests/launcher-helper-client.test.ts), [native adapter tests](../../tests/pro-context.test.ts).

History: new operator-authorized exception introduced in `.4`; prior decisions remain documented
with dated amendments. No dependency or separate executor was introduced.
