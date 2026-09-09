# Architecture decision records

| Record | Status | Scope |
| --- | --- | --- |
| [0001: Pro retained context](0001-pro-context.md) | Accepted | Pro model memory, submission identity, native compaction, MCP continuation |
| [0002: Patched build dependencies](0002-build-dependencies.md) | Accepted | Minimal audited dependency overrides for the local installer |
| [0003: Packaged startup](0003-packaged-startup.md) | Accepted | Bounded cold initialization and noninteractive smoke failures |

Records describe the custom `5.0.7-pro-context.1` build based on upstream commit
`e85e3693fdb4e3e033348c08df0298c20fcdb612`. Changes to these decisions must preserve their history.

The [local build validation receipt](../pro-context-validation.md) records completed experiments,
package evidence, skipped checks, and the remaining authenticated-service acceptance gap.
