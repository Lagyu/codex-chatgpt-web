# ADR-0009: Keep continuation text minimal

Date: 2026-09-14. Status: Accepted. Build: `5.0.7-pro-context.6`.

## Context and decision

The operator reported that automatic recovery now works as intended, but found its message
redundant. The retained chat already contains the task, instructions and tool contract. The
failure explanation, repeated task reminders, work-inspection advice and XML wrapper add
instructions that the operator does not want repeated.

The continuation is now:

```text
Please continue.

Use this new turn_token for Codex Native calls: <fresh token>
```

The token line is present only when native tools are enabled. It remains necessary because
[ADR-0007](0007-thinking-failure-continuation.md) retires the old response's capability before
continuing. Token validation, rotation, settlement, cancellation, five-attempt limits, delays
and chat retention from [ADR-0008](0008-bounded-failure-recovery.md) are unchanged. No dependency
or prompt-setting mechanism is added.

## Alternatives and comparative evidence

| Alternative | Assessment |
| --- | --- |
| Keep the `.5` message | Local recovery works, but the operator explicitly finds its repeated instructions redundant. |
| Only `Please continue.` in every mode | Appropriate without native tools; tool-enabled responses would lack their newly issued capability. |
| Keep the short instruction and XML token wrapper | Valid, but the wrapper has no local consumer and adds no required routing information. |
| Short instruction plus one new-token line | Selected: supplies the intent and the only changed tool value without repeating task guidance. |
| Keep the old capability to omit the token line | Rejected: would change the validated tool-retirement and late-call behavior merely to shorten text. |

The comparison evaluates the actual `.5` formatter at commit `cb966d6` and the updated formatter
using the same synthetic 37-character token. Plain messages shrink from 320 to 16 ASCII
characters; tool-enabled messages shrink from 623 to 103. The selected message contains exactly
one token and no XML wrapper. Character counts establish reduced repetition, not improved model
performance. Existing worker/helper/adapter regressions exercise the short message through
continuation, IPC and fresh-token native calls; old capabilities must still be rejected.

Implementation: [continuation formatter](../../src/adapters/chatgpt-web/thinking-failure-continuation.ts).
Verification: [worker and broker tests](../../tests/thinking-failure-continuation.test.ts),
[helper IPC](../../tests/launcher-helper-client.test.ts), and [Pro adapter tests](../../tests/pro-context.test.ts).
Only the existing assertion about the removed token instruction needs updating; no new test
framework or behavioral policy is introduced for this text change.

## Completed validation

On macOS arm64 with Bun 1.4.0:

- `bun run check-version` and `bun run typecheck`: passed.
- `bun test tests/thinking-failure-continuation.test.ts tests/launcher-helper-client.test.ts tests/pro-context.test.ts`:
  51 passed, 0 failed, 312 assertions.
- `bun run app:package`: passed, including launcher type checking and renderer/runtime build.
- `bun run app:smoke`: `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64`, using an isolated profile.
- One-shot LaunchAgent: `KeepAlive=false`, persistent logs, verified exit 0, unloaded and archived.

The broader full suite and separate native CLI smoke were not repeated for this formatter-only
change; their `.5` results are in the [prior validation receipt](../bounded-recovery-validation.md).
Authenticated model comparisons, notarization and Windows/Linux packaging were not performed.

Evidence identifier: `minimal-continuation-20260914-004614`. The ignored evidence pack contains
the comparison script pinned to `.5`, results, source hashes, validation logs and lifecycle checks.
Manifest SHA-256: `16cbf143f38a89ffd803e41a825bbd5ea19fc9dc9e0bc3e1b4c4c7f39b36ccf2`.

| Installer | SHA-256 |
| --- | --- |
| `codex-web-gpt-5.0.7-pro-context.6-mac-arm64.dmg` | `7de469b305f8dea45992aec14b1fcf02fe636657bcbcad1f109a64948d4b75ea` |
| `codex-web-gpt-5.0.7-pro-context.6-mac-arm64.zip` | `a2d31c54972243e5e7ba3241f8b965ad8f94c5fe0a07b5a80ca5e0815506a86f` |

## Tradeoffs and limitations

The model still has to decide how to continue from its retained conversation. Removing the
inspection reminder leaves that judgment to its existing task instructions and context; the
transport continues to settle old work and prevents tool-request replay. There is no controlled
live model comparison for the wording, so behavioral equivalence is provisional beyond the
local transport checks. The next ordinary recovery can confirm that the model uses the new
token and continues without asking for the removed reminders.

The operator's report confirms that recovery worked in their use of `.5`; it does not independently
verify every exhaustion, cancellation or UI timing case. No paid Pro turn is needed for this
message-only update. A new installer is built because the production app runs its bundled code.

History: `.4` introduced the longer prompt; `.5` repaired the recovery lifecycle; `.6` shortens
only the continuation text at the operator's request. Earlier wording and rationale remain in
ADR-0007 and ADR-0008 as historical decisions.
