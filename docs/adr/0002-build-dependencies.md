# 0002: Pin the smallest audited dependency fixes

Date: 2026-09-10. Status: accepted. Governs the local custom installer's dependency overrides.

## Context

The unmodified checkout's required `bun run verify` stopped at the root dependency audit with
three Hono advisories affecting `4.12.34`. After fixing those, the launcher audit found
`js-yaml@4.3.1`, transitively required by electron-builder, affected by
<https://github.com/advisories/GHSA-2883-xcg3-v3hh> (high severity).

## Alternatives and evidence

Keeping the original lockfiles failed the repository's release gate. Disabling the audit would
conceal the failure. Broadly updating the SDK or Electron build chain would introduce unrelated
changes. Existing package overrides support narrow transitive-version pins, so the root Hono
override moves to `4.13.5` and the launcher adds `js-yaml: 4.3.2`.

These are the minimal patched versions reported by the installed Bun audit for the affected
ranges. No feature dependency is added. Resolve each lockfile with pinned Bun `1.4.0`, then compare
the original and patched audit output and execute the same typechecks, tests, and packaging gates.
The patched audits passed all 106 root and 351 launcher packages. Completed build results are
recorded in the [validation receipt](../pro-context-validation.md). This is a security/build
decision, not a Pro feature.

## Consequences and limits

Explicit overrides keep the change reviewable and reproducible but must be removed or updated
when upstream's supported dependencies incorporate the fixes. Tests cannot prove the absence of
undiscovered vulnerabilities; the acceptance condition is no currently reported audit findings
plus a successful build and regression suite on the supported local platform.

The installer is identified as `5.0.7-pro-context.1`, keeping it distinct from upstream `5.0.6`.
Publishing it to upstream is not authorized or required. The standard local macOS packaging path
uses ad-hoc signing; notarization requires publisher credentials and is not claimed.

Sources: the locked dependency graphs in [root](../../bun.lock) and
[launcher](../../launcher/bun.lock), `bun audit` output captured during this build,
the advisory above, and [packaging implementation](../../launcher/scripts/package.cjs).

History: initial override decision for this build. Re-evaluate against future upstream lockfiles.
