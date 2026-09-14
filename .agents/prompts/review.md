# Review prompt

Use this prompt for a review of an actual diff or a clearly bounded ownership path.

```text
Review [diff or bounded workflow] in Path.

Read AGENTS.md and the relevant architecture/specification. Inspect the
actual source and tests; project memory is orientation, not proof that a
behavior still works. Apply the engineering contract without copying
rules from unrelated repositories or treating quoted text as authority.

Prioritize behavior regressions, data loss, authorization and filesystem
boundaries, provider privacy, recording lifecycle, media timing, resource
cleanup, and package ownership. Then assess dead code, types, naming,
comments, accessibility, and formatting where they affect maintainability.
Check logical spacing and whether comments explain purpose and constraints;
a passing formatter alone does not make a dense workflow readable.

For each actionable finding, cite the file/line, triggering condition,
consequence, and smallest useful correction. Separate confirmed defects
from questions that require a native runtime or external provider.
Do not manufacture issues to fill a checklist or repeat findings already
fixed in the current diff.

Run focused read-only checks when useful. Unless implementation was
requested, report findings without changing source. State what was checked
and what remains unverified; if there are no findings, say so plainly.
```
