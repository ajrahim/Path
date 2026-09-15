---
name: spec-create
description: "Draft or update a new feature specification adhering to the Minimal Spec-Driven Development Standard. Use when: creating a spec, drafting a new feature, writing specifications, defining acceptance criteria, or planning a feature."
argument-hint: "<FeatureName>"
user-invocable: true
---

# Spec Create Skill

Creates a standardized, concise (20–80 lines) feature specification in `specs/<FeatureName>.md` following the Minimal Spec-Driven Development Standard.

## When to Use

- Defining a new feature, enhancement, or architectural change
- Establishing observable requirements and testable acceptance criteria
- Setting explicit `Out of Scope` boundaries to prevent AI agent scope expansion

## Specification Structure

Every specification is created in `specs/<FeatureName>.md` (PascalCase) using this template:

```markdown
# <FeatureName>

Status: Draft

## Goal

Short 1-2 sentence description of the outcome this feature creates.

## User Experience

Numbered user/system interaction flow:

1. User does X.
2. System performs Y.
3. User receives Z.

## Requirements

- Functional requirement
- Functional requirement

## Acceptance Criteria

- [ ] Observable and testable outcome
- [ ] Specific condition with measurable output
- [ ] Error condition with expected error code/behavior

## Constraints

- Technical, security, performance, or compatibility constraints that matter.

## Technical Notes

Guidance on existing services, APIs, and abstractions to reuse.

## Out of Scope

Explicit list of adjacent features, future ideas, or refactors that must NOT be implemented.

- Unrelated capability
- Future extension
- Speculative abstraction
```

## Guidelines for Strong Specifications

1. **Observable Acceptance Criteria:**
   - Write concrete, testable outcomes (e.g. `- [ ] Rejecting invalid ranges returns INVALID_RANGE`).
   - Avoid ambiguous words like `fast`, `clean`, `proper`, `user-friendly`, `efficient` unless quantified.
2. **Mandatory Out of Scope:**
   - Clearly list adjacent capabilities and potential scope traps to keep agents strictly bounded.
3. **Spec Sizing:**
   - Keep specs focused and between 20–80 lines. If a specification exceeds 100 lines, consider splitting it into smaller, independently deliverable features.
4. **Initial Status:**
   - New specifications always start with `Status: Draft`.
