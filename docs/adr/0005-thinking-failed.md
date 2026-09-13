# ADR-0005: Treat explicit Thinking failed status as terminal

Date: 2026-09-13. Status: Accepted; continuation policy amended by ADR-0007.

## Context and observed evidence

A read-only inspection of the operator's failed ChatGPT tab found one assistant turn, no stop
button, no answer text and no completed-turn copy action. Its collapsed UI contained an ordinary
`button` with `aria-expanded="false"` and exact text `Thinking failed`, nested inside transition
containers. The button had neither an alert role nor an error test ID. Expanding it is unnecessary
and must not be required to detect failure.

The previous detector only recognized `Stopped thinking` and generic error controls. The generic
DOM health tracker has no terminal condition for a present, empty response without a completion
action. Against the observed snapshot, advancing the old tracker's clock by one hour still returns
no error. The new browser-side snapshot identifies `thinkingFailedVisible: true` on that same
collapsed, unmodified live response.

## Decision and alternatives

Treat exact `Thinking failed` UI status inside the bound assistant response as HTTP 502,
`server_error`, code `chatgpt_thinking_failed`, `retryable: false`. Both ordinary and multipart
response loops check it before acknowledging further MCP work or applying liveness grace periods.
The message explains that the response failed and was not replayed automatically. It does not
invent a quota, compaction, chat-mode or network cause.

| Alternative | Assessment |
| --- | --- |
| Impose a shorter total turn deadline | Can cancel healthy long Pro reasoning and does not identify the explicit error |
| Expand the reasoning panel | Mutates the page, requires extra selectors, and is unnecessary for the observed status |
| Search the whole page for the phrase | Can match the user's prompt, an old answer, or a quoted error |
| Recognize the bound response's visible status | Selected; matches the actual collapsed failure without a new time limit |
| Automatically resend or reconstruct the turn | Rejected; conflicts with ADR-0001 and may duplicate tool execution |

The detector excludes model Markdown, code, blockquotes and hidden ancestors. Exact accessible
labels and normalized text nodes support the observed UI while ignoring longer phrases. The
existing DOM revision cache already observes text changes and relevant visibility/ARIA attributes.
The existing `Stopped thinking` failure remains supported.

## Evaluation and limits

Regression fixtures preserve the observed collapsed button structure without recording private
conversation contents. They execute the shipped detector, compare expanded and collapsed states,
exclude old/user turns and quoted text, and prove that live MCP activity cannot suppress the first
failure observation. The live read-only comparison and final validation are recorded in the
[update validation receipt](../regular-chat-validation.md).

The UI proves that ChatGPT failed, not why it failed. This decision fixes bridge error reporting;
it cannot prevent the upstream failure. Localized labels and future UI variants without the
observed structural evidence require separate evidence and regression coverage.

Governing code: `src/adapters/chatgpt-web/adapter-error.ts` and
`src/adapters/chatgpt-web/browser-worker.ts`. Tests: `tests/regular-chat-and-failure.test.ts`.

## Decision history

The original `.3` behavior above remains the fallback. On 2026-09-13 the operator explicitly
authorized [ADR-0007](0007-thinking-failure-continuation.md): a confirmed failure after strictly
more than 60 minutes may continue in place. Existing authorized tool batches may settle once
before that continuation; old capabilities are retired. Ineligible failures still stop with
`chatgpt_thinking_failed`, and original prompts and tool requests are never replayed.
