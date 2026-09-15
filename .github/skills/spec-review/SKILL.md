---
name: spec-review
description: "Review code diffs, pull requests, or implementations against a feature specification. Use when: reviewing a spec implementation, verifying acceptance criteria evidence, checking for scope creep, or auditing spec adherence."
argument-hint: "specs/<FeatureName>.md"
user-invocable: true
---

# Spec Review Skill

Audits code changes against a target specification in `specs/<FeatureName>.md` to verify requirement adherence, empirical evidence, scope control, and engineering contracts.

## Review Priorities

1. **Scope & Out of Scope Verification:**
   - Did the implementation stay strictly within the stated requirements?
   - Did any items listed in `Out of Scope` leak into the changes?
2. **Acceptance Criteria & Evidence:**
   - Is every checked Acceptance Criterion (`- [x]`) supported by a passing automated test or verifiable runtime check?
   - Are there any unverified criteria claimed as complete?
3. **Engineering & Architecture Compliance:**
   - PascalCase for classes, components, domain concepts, and file basenames.
   - camelCase for functions, operations, and variables.
   - Strict typing with zero `any` or loose casts.
   - Guard clauses, early returns, minimal nesting, and phase breathing room.
   - IPC schema validation via Zod in `packages/shared/src/Ipc.ts` and `apps/desktop/src/ipc/RegisterIpc.ts`.
   - Dependency directions checked by `.dependency-cruiser.cjs`.

## Review Output Format

For each actionable finding:

- **Location:** `path/to/file.ts#L10`
- **Issue:** Description of the defect, unverified criterion, or scope creep.
- **Consequence:** Concrete failure mode or contract violation.
- **Remediation:** Minimal, targeted correction.

If all criteria are verified and no defects exist, state clearly that the specification is fully verified and ready to ship.
