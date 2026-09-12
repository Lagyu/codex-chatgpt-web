# ADR-0004: Use regular chats and preserve operator personalization

Date: 2026-09-13. Status: Accepted as an operator-requested experiment.

## Context and decision

The operator reported another long Pro response ending with `Thinking failed` and requested
regular chats everywhere. The operator keeps personalization off and explicitly requested that
the bridge leave that setting alone. Whether Temporary Chat causes the upstream failure is
unknown; this change must not claim to establish that causal link.

Create chats at `https://chatgpt.com/` in the launcher, automatic worker, manual-task launcher,
login and verification flows. Accept both the fresh home document and its saved `/c/<id>`
conversation URL; reject Temporary Chat parameters and unrelated origins or paths. Session
evidence must explicitly prove `regular: true` with a valid URL on both sides of the helper
boundary. A maintenance preparation preserves an already-hydrated home document; a retained
task keeps its exact saved conversation.

Remove the Temporary Chat onboarding and personalization preflight. Regular chats attach the
configured connector directly using the existing exact-row, selected-pill and composer-integrity
checks. The bridge neither enables nor disables personalization. Existing cancellation cleanup,
connector identity checks and bounded catalog refresh remain in place.

Restart the updated launcher and start a new Codex task. A retained Temporary Chat is rejected
before another automatic submission; it is never navigated away, converted or replayed as a
recovery. Zero Risk still requires manual model selection and submission and receives no new DOM
inspection. ADR-0001's single-response Pro context policy is unchanged. Regular saved chats do
not add a persistent-URL recovery mechanism or remove the existing retained-tab limits.

## Alternatives and evidence

| Alternative | Assessment |
| --- | --- |
| Keep Temporary Chat | Does not satisfy the requested experiment |
| Add a user-configurable chat-mode toggle | Unnecessary for the explicit always-regular requirement; adds mixed-mode state and migration cases |
| Open regular chats and change personalization on every task | Conflicts with the operator's preference and risks changing account behavior |
| Regular chats with existing personalization | Selected; uses the ordinary chat surface without extra settings mutations |

Evaluation covers URL tables shared across worker and launcher tests; authentication and helper
evidence; fresh versus retained navigation; automatic and manual launch URLs; and connector
fixtures that throw if personalization controls are touched. Full verification, package and live
acceptance results are recorded in the [update validation receipt](../regular-chat-validation.md).

## Tradeoffs and limitations

Regular chats use the account's existing history settings, so the previous Temporary Chat privacy
description no longer applies. No account settings are changed. Long responses may still fail
inside ChatGPT. Establishing an effect on the failure rate requires future comparable long runs,
with run duration, model, workload and failure outcome recorded; one short smoke cannot prove it.

Governing code: `src/chatgpt-session.ts`, `src/browser-login.ts`, `src/launcher-browser-host.ts`,
`src/adapters/chatgpt-web/browser-worker.ts`, and `launcher/electron/browser-host.cjs`.

## History

Supersedes the fresh Temporary Chat surface described in the original architecture and Pro build
documentation. ADR-0001's context ownership and ADR-0003's bounded startup decisions remain active.
