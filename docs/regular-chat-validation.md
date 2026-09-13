# Regular chats, Thinking failed, and smoke contention: validation

Build: `5.0.7-pro-context.3`, macOS arm64, 2026-09-13.
Decisions: [regular chats](adr/0004-regular-chats.md), [failure detection](adr/0005-thinking-failed.md),
and [smoke contention](adr/0006-smoke-contention.md).

## Observed live evidence

The operator's already-failed ChatGPT conversation was inspected read-only. It was not expanded,
submitted or reloaded. The response snapshot reported a present assistant response, zero answer
characters, no completion action, `stoppedThinkingVisible: false` and
`thinkingFailedVisible: true`. Feeding the same observation into the previous DOM health tracker,
with its clock advanced by an hour, produced no error. This reproduces the bridge's detection gap
without spending another Pro turn.

The actual launcher flow in the installed `.2` build was exercised through Setup → Run smoke test.
The expected 19-character answer appeared, the copy action became available, the stop control
disappeared, the response request finished, and the UI reported success in 11.2 seconds. This
confirms the complete smoke path for the unchanged helper and its completion evidence. The earlier
run that prompted this change exposed the expected answer but kept the stop control until the
90-second helper deadline; its underlying ChatGPT stream failure remains unexplained.

After packaging, the `.3` application was started and reached the regular ChatGPT home page with
an authenticated composer. A live `.3` smoke/contention overlap was attempted, but the launcher
was still refreshing its connector catalog and kept the smoke button disabled for the 30-second
start window. It therefore did not start a smoke test and produced no contention observation.
This is recorded as an acceptance gap; it does not weaken the HTTP and unit/integration evidence
below.

## Automated validation

The complete verification sequence passed:

| Check | Result |
| --- | --- |
| Root dependency audit | No vulnerabilities, 106 packages |
| Launcher dependency audit | No vulnerabilities, 351 packages |
| Root TypeScript tests | 717 passed, 1 platform-specific skip, 0 failed; 718 tests across 52 files |
| Launcher tests | 300 passed, 1 platform-specific skip, 0 failed; 301 tests |
| Type checks and renderer build | Passed |
| Relocatable runtime smoke | `RELOCATABLE_RUNTIME_SMOKE_OK` |
| Native Codex Pro-context smoke | `NATIVE_CODEX_PRO_CONTEXT_SMOKE_OK` |
| Packaged launcher smoke | `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64` |
| Package signature and runtime manifest | Passed for the ad-hoc macOS arm64 package |

The new focused coverage verifies regular-chat URL and session evidence, exact connector handling
without personalization mutations, the collapsed and expanded `Thinking failed` structures,
response identity, live-MCP precedence, typed HTTP 503 smoke refusals, bounded retry, unchanged
request identity, cancellation during the wait, and maintenance-lock cleanup after failure.
The smoke-contended path waits only after the launcher explicitly reports
`browser_smoke_test_busy`; ordinary errors and ambiguous transport failures still fail normally.

The release assets have these SHA-256 checksums:

```text
df0e10677965dacecf0aeb7f8a4ba15d63ef4a2ebdcbfca3d54c08359195db50  codex-web-gpt-5.0.7-pro-context.3-mac-arm64.zip
96e168c6718ea1da1c6d061ce23349a68ec02dbbc05c2e7a683af25090a53081  codex-web-gpt-5.0.7-pro-context.3-mac-arm64.dmg
```

The package is ad-hoc signed for local use; macOS notarization was skipped because no notarization
credentials/options were configured. Windows, Linux, Intel macOS, and a new authenticated `.3`
Pro turn were not run in this environment.

## Scope and limitations

Regular-chat behavior is implemented in the worker, launcher browser host, login flow, and session
evidence boundary. The bridge leaves personalization unchanged. A visible `Thinking failed` status
now becomes a non-retryable `chatgpt_thinking_failed` server error before further MCP
acknowledgements. Smoke contention is handled before session inspection or turn allocation, with a
two-minute wait and one-second polling after the explicit busy response. No ChatGPT prompt is
replayed by this wait.

The live evidence proves the UI state and bridge behavior, not the cause of ChatGPT's upstream
failure or that regular chats reduce its frequency. The earlier stalled smoke may still recur, and
the expected text alone is intentionally insufficient to declare a smoke test complete. Future
authenticated `.3` validation should repeat the actual button flow after catalog refresh has
settled and, if possible, overlap a read-only session inspection with the smoke lock.
