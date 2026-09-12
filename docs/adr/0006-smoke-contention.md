# ADR-0006: Wait for smoke-test admission without replaying turns

Date: 2026-09-13. Status: Accepted.

## Evidence and problem

The operator reported `ChatGPT browser is busy with browser smoke test`. The launcher log shows
a smoke run starting at 21:27:42 UTC on September 12, followed by rejected session/turn control
requests while it held the maintenance lock. The expected 19-character answer appeared, but
ChatGPT still exposed a stop button and no completion action; the helper timed out after 90
seconds. A repeat through the actual launcher button completed in 11.2 seconds with the same
installed build, including the copy action and removal of the stop button. The lock was released.

This establishes two distinct outcomes: a stalled completion during the earlier smoke response,
whose underlying cause remains unknown, and deterministic rejection of incoming Codex requests
while smoke owns the browser. A direct IPC probe without activating the browser also encountered
the existing measured-bounds guard; the actual-button experiment includes the required renderer
activation and is the relevant end-to-end result.

## Decision

Retain the exclusive maintenance lock. Before any page inspection or turn allocation, smoke
contention returns HTTP 503 with `browser_smoke_test_busy`. Automatic turn admission and session
inspection wait for that exact response, polling once per second for at most two minutes. This
budget covers the existing 90-second helper deadline and bounded shutdown. Each HTTP operation
keeps its original timeout. Turn cancellation interrupts the wait and prevents later admission.

The repeated local request carries the same owner, conversation and connector identity. These
are admission checks explicitly rejected before mutation; no ChatGPT message has been submitted.
Other errors, transport failures, missing retained conversations, authentication errors and
ambiguous acknowledgements do not enter this wait. Heartbeats and turn completion are unchanged.
The Pro policy in ADR-0001 remains intact. Zero Risk cannot run browser smoke tests.

## Alternatives

| Alternative | Assessment |
| --- | --- |
| Keep generic HTTP 400 busy errors | Needlessly fails new Codex turns during a bounded diagnostic |
| Relax the maintenance lock | Risks simultaneous composer, model and authentication mutations |
| Move smoke to a separately owned browser tab | Plausible future design, but requires separate capability-probe and helper/lease lifecycle changes |
| Accept the expected text before stream completion | Fails to verify the complete round trip and can conceal a stalled stream |
| Automatically replay failed ChatGPT requests | Conflicts with Pro context ownership and can duplicate tool actions |
| Wait only after explicit refusal before admission | Selected; narrow change with unambiguous evidence that no turn began |

## Evaluation and limitations

Focused tests exercise the real control-server status contract, unchanged request identity, one
successful admission after waiting, cancellation, bounded waits, ordinary-error passthrough, and
maintenance-lock release after failure. Full and installed validation is recorded in the
[validation receipt](../regular-chat-validation.md).

This fixes the collateral busy error on incoming requests. It does not establish or cure the
cause of the earlier ChatGPT stream stall, extend the smoke helper's deadline, or weaken the
requirement for completed-turn evidence. A stalled smoke may still fail its own diagnostic.
