# Implementation prompt

Template for bounded implementation tasks:

```text
Implement [requested behavior] in Path.

1. Context: Read AGENTS.md, .agents/instructions/Architecture.md, and the relevant specification in .agents/specs/.
2. Scope: [affected workflow, target outcome, and acceptance criteria].
3. Constraints: Preserve existing contracts, stored media/metadata, and strict typing (zero `any`).
4. Architecture: Place code in its proper domain layer. Do not create generic dumping grounds.
5. Verification: Add focused Vitest coverage. Run `npm run check` and `npm test`.

Report: files changed, tests added, verification command results, and any unverified platform constraints.
```
