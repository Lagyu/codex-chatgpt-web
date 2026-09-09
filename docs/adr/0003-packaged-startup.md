# 0003: Bound cold startup and unattended package failures

Date: 2026-09-10. Status: accepted. Governs Launcher idle-document bootstrap and package smoke.

## Context and evidence

The first macOS arm64 package passed archive signature and runtime verification, but its isolated
launch failed with `Browser idle document did not commit within 10000ms`. The retained startup log
records browser control initialization at `2026-09-09T21:48:51.986Z` and failure at
`2026-09-09T21:49:02.001Z`. Process inspection showed the Electron helper processes appearing
approximately 22 seconds after the application process. The cause of that cold-start delay is not
established; code-signing checks and host load are possible contributors, not proven diagnoses.

The fatal-error handler opened a synchronous error dialog even in `--launcher-smoke-test` mode.
The parent script's default termination signal did not end that dialog, so the automated check
remained blocked beyond its configured 45-second timeout. Only the isolated failed test app was
terminated; production processes were left running. Failure logs were preserved.

## Alternatives and evaluation

| Alternative | Evaluation |
| --- | --- |
| Retry until the host is warm | Does not address a real first-launch deadline or establish reliable failure reporting. Rejected. |
| Remove the startup deadline | A renderer that never commits would hang indefinitely. Rejected. |
| Bypass the embedded browser during smoke | Would conceal the observed startup defect. Rejected. |
| Retry or reload the document | Adds recovery behavior unnecessarily. Rejected. |
| Allow one bounded cold load and make smoke failures noninteractive | Selected; reuses existing exact-document commit checks and normal fatal logging. |

The idle-document deadline becomes 60 seconds, matching the existing browser navigation guard's
order of magnitude. The commit must still be the exact requested local document. There is one
load attempt; navigation errors, renderer crashes and destroyed contents still fail immediately.
This is application initialization, not recovery of any Pro conversation.

A controlled fake-clock regression supplies the same commit event at 22 seconds: the old explicit
10-second budget rejects it, while the new default accepts it with exactly one load. An additional
stalled case remains pending at 59,999 ms and rejects at 60,000 ms without retrying. Existing
navigation and renderer failure cases remain in the suite. The first rebuilt signed application
passed the isolated `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64` check; final artifact evidence is in
the [validation receipt](../pro-context-validation.md).

Smoke-mode fatal errors now write stderr and exit without a dialog. Ordinary interactive launches
retain the existing error dialog. The smoke runner permits 120 seconds for durable installation,
browser bootstrap and executable validation, and uses `SIGKILL` if a child exceeds its deadline.
All runner children operate on isolated test artifacts; this does not change normal app shutdown.

## Tradeoffs, limitations and sources

An otherwise silent stalled local document can now delay startup failure by up to 50 more seconds.
The selected limit is an engineering guard, not a measured performance guarantee or a solution to
all host-level startup failures. The experiment validates deadline behavior; successful local
packaging does not establish reliability across every supported platform or cold host.

Sources: the preserved package-smoke fatal/startup logs, process timing inspection,
[browser bootstrap](../../launcher/electron/browser-host.cjs),
[fatal handler](../../launcher/electron/main.cjs),
[smoke runner](../../launcher/scripts/smoke-package.cjs), and
[controlled regression](../../launcher/tests/browser-host.test.cjs).

History: discovered while validating `5.0.7-pro-context.1`; no previous decision superseded.
