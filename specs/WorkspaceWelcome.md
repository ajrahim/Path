# Workspace welcome

Status: Shipped

With no recording selected and no recording in progress, the entire area beside
the library shows `WorkspaceWelcome`. Selecting a recording restores the existing
capture, activity, and guide panes. Active capture is never hidden by this state.

New recording opens the existing source dialog. The Generate Specs, Help Guide,
and Provide Feedback cards first save the matching instruction-flow selection,
then open the same dialog. A failed storage write keeps the welcome state visible
with an error. Existing custom prompts are retained. Canceling source selection
retains the chosen document type.

Provide Feedback is a built-in preset in `packages/shared/src/InstructionFlows.ts`, also available
in the guide's prompt dropdown. Its instructions request timestamped app-review
findings, observed reproduction steps, user impact, and constructive suggestions,
with observations separated from assumptions. The preset uses the existing
generation, editing, copying, saving, and export pipeline.

`WorkspaceWelcome.test.tsx` verifies all three shortcuts, preserved custom prompts,
the primary action, and storage failure. `InstructionFlows.test.ts` checks feedback
restoration and prompt grounding. Browser checks cover the unified empty layout,
source dialog, return to the selected recording, and Feedback dropdown selection.
Live AI output quality is outside these UI and preset checks.
