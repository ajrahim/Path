---
name: spec-implement
description: "Implement an approved feature specification with the two-phase Human Approval Gate workflow. Use when: implementing a spec, building a feature from specs/, executing a specification, or turning a spec into code and evidence."
argument-hint: "specs/<FeatureName>.md"
user-invocable: true
---

# Spec Implement Skill

Executes the implementation of a feature specification in `specs/<FeatureName>.md` with strict scope control, human gate verification, and evidence-backed completion.

## Implementation Lifecycle

```text
Spec (Active) → Inspect & Plan → STOP (Human Gate) → Approved → Implement → Test & Verify → Evidence → Spec (Shipped)
```

---

## Phase 1: Pre-Implementation Planning (Mandatory STOP)

When given a specification (`specs/<FeatureName>.md`):

1. **Read the Specification:** Read the entire specification, noting requirements, acceptance criteria, constraints, and `Out of Scope`.
2. **Inspect Existing Code:** Inspect the current implementation, existing patterns, and relevant test files.
3. **Identify Reusable Abstractions:** Determine existing domain services, IPC channels, database repositories, or components to reuse.
4. **Identify File Scope:** List the minimal set of files to create or modify.
5. **Surface Ambiguities:** If any product behavior is unclear or missing, surface it immediately. Do not invent product rules.
6. **Propose Plan & STOP:**
   - Present a concise implementation plan.
   - **STOP IMMEDIATELY.** Do not write or edit application code until the user approves or adjusts the plan.

---

## Phase 2: Execution & Verification (Post-Approval)

After human approval is received:

1. **Strict Scope Control:**
   - Implement only what is required by the specification.
   - Strictly obey `Out of Scope`—do not add speculative abstractions, unrequested UI elements, or unrelated refactors.
   - Follow `AGENTS.md` and `.agents/instructions/Engineering.md` (PascalCase files/classes, camelCase functions, zero `any`, guard clauses, phase breathing room).
2. **Add Automated Tests:**
   - Add or update Vitest unit/component tests directly verifying the Acceptance Criteria.
3. **Execute Verification Gates:**
   - Run `npm run check` (Prettier, ESLint, TypeScript across workspaces, dependency-cruiser, Knip).
   - Run `npm test` (All tests must pass).
4. **Provide Empirical Evidence:**
   - For every Acceptance Criterion, report:
     - The quoted criterion
     - The test or check that verified it
     - The result: `PASS` or `UNVERIFIED`
   - Statements like "implemented" or "working" are NOT evidence.
5. **Update Specification Checkboxes:**
   - Check off verified criteria in `specs/<FeatureName>.md` (`- [x]`).
   - If all criteria are verified with evidence, update header to `Status: Shipped`.
6. **Summary Report:**
   - Report all files changed, assumptions made, and test suite outcomes.
