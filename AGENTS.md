# tracker-mcp sidecar

Implementation repo for the TypeScript stdio MCP server. Product intent lives
in the sibling workspace folder `mcp dev/` (VISION, ARCHITECTURE, TASKS, ADRs,
WORKFLOW).

OpenCode uses the global ECC catalog. This repo’s default entry agent is
**`light`**. Follow the named-slice sequence in `../mcp dev/WORKFLOW.md` when
that tree is present; otherwise follow `TASKS.md` order: plan → TDD implement →
fault/code/security/test reviews → one fix loop.

- No `tracker.jar` on the classpath.
- Do not duplicate ECC agent files here.
- Commit or push only when the owner asks.
