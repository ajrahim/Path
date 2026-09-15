# Review prompt

Template for evidence-based code review:

```text
Review [diff, PR, or module path] in Path.

1. Context: Check AGENTS.md, .agents/instructions/engineering.md, and .agents/architecture.md.
2. Priorities: Regressions, data loss, IPC schema safety, AI credential encryption, resource disposal, memory management, and package import direction.
3. Code Quality: Strict typing (no `any`), PascalCase/camelCase conventions, early returns/guard clauses, and clean phase separation.
4. Output: For each issue, provide file/line, triggering condition, impact, and minimal fix. If no issues, state plainly.
```
