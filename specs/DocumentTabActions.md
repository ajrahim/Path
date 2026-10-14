# Document Tab Actions

Status: Shipped

## Goal

Use reorderable workflow tabs with a Rename/Delete context menu, and a compact document header with the flow selector, Combine/Split switch, and Generate action.

## User Experience

1. The top row contains the document flow selector, a single Combine/Split toggle switch, and an icon-only Generate button with a Generate tooltip and accessible name. The flow title uses a compact 12 px font. Split mode shows named workflow tabs below with an icon-only Plus control at the right edge and no count; Combine mode hides that row. Tabs have rounded top corners and a bottom divider across the row, with an opening beneath the selected tab.
2. Right-clicking a split tab opens Rename and Delete actions using the existing context-menu design.
3. Rename opens the existing workflow-name modal prefilled with the current title. Confirming persists the new title; Cancel or Escape makes no change.
4. Delete removes the split from the editable plan, using the existing save/discard guard when the active document is dirty.
5. Drag a tab before or after another tab to reorder the workflow plan. Alt+Shift+Left/Right moves a focused tab one position. The order persists per recording; reordering retains the active document, dirty text, and history.

## Requirements

- Remove the inline X buttons and their reserved layout width; keep compact tab spacing and horizontal overflow.
- Keep the document flow selector, Combine/Split switch, and Generate action on one row. The switch is checked for Split, unchecked for Combine, and supports Space/Enter activation. Preserve busy-state disabling and the existing dirty-document guard.
- Use a build icon for Generate with no visible text, a Generate tooltip and accessible name, and a spinner with an accessible pending state during generation.
- Keep only the Plus control at the right edge of the workflow-tab row, with no split-count label. The tab list scrolls horizontally in the remaining space. Preserve Combine hiding all split-specific controls.
- Plus has no resting border or background; hovering an enabled Plus uses the shared primary blue with a white icon. Preserve its tooltip, focus outline, and disabled state.
- Use rounded top corners and square bottom corners, with a bottom divider across the row except beneath the active tab. Keep focus visible along the tab's top and sides without closing the active tab's bottom opening.
- Inactive tabs are transparent and borderless with subdued text. The active tab keeps its top/side outline; active or focused tab text is white in dark mode and uses the readable foreground in light mode.
- Persist drag and keyboard reordering through the existing versioned workflow-plan API. Reject unrelated drops, preserve identities, scopes, document links and active selection, and retain the prior order on persistence failure. Disable reordering while busy; do not create document revisions or save/discard dirty text just to reorder.
- Reuse the existing cursor-anchored context menu, including viewport clamping, outside dismissal, focus restoration, and keyboard navigation.
- Support opening the tab menu with the keyboard context-menu key or Shift+F10.
- Reuse the workflow-name modal for Rename with its title selected for editing, validation feedback, and retry after failed persistence.
- Require nonempty, trimmed titles of at most 120 characters and case-insensitive uniqueness, excluding the renamed workflow itself.
- Persist a title change through the existing versioned workflow-plan API. Preserve workflow identity, evidence scope, active selection, document contents, drafts, and history.
- Delete removes a tab from the current editable plan without deleting its saved document or revisions. Preserve the dirty-document guard; an empty tab list remains empty on reopening while Generate stays available.
- Disable tab actions during existing busy states. Tab edits organize the current collection; Split Generate independently determines fresh workflows and documents from recording content, as described in [Editable Document Splits](EditableDocumentSplits.md).

## Acceptance Criteria

- [x] The compact flow title, Combine/Split toggle switch, and icon-only Generate action share one row with visible focus, accessible labels, and pending/disabled states.
- [x] Tabs have rounded top corners, an open active-tab bottom, no inline X control or split-count label, and a Plus button at the right edge.
- [x] Drag and Alt+Shift+Left/Right reordering persist the reviewed workflow order while preserving selection, scopes, documents and dirty text; failed writes leave the prior order intact.
- [x] Right-click and keyboard invocation open a menu containing Rename and Delete; dismissal and focus behavior are verified.
- [x] Rename persists a unique title while retaining workflow identity, scope, active selection, and saved document history.
- [x] Empty, duplicate, and oversized names are rejected; cancel and failed persistence do not discard the prior title.
- [x] Delete uses the existing dirty guard and preserves saved data; removing the final split disables Split generation.
- [x] Light/dark desktop and narrow-pane browser checks show contained menus and controls with no overlap or spacing regression.
- [x] Focused tests and required repository quality, test, and build gates have empirical evidence before marking Shipped.

## Verification Evidence

| Acceptance Criterion                                                                                                         | Evidence                                                                                                                                                                                                               | Result |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| "Tabs have no inline X control or reserved close-button space, and the structure control row is right-aligned."              | Structure component regression and browser geometry: no close buttons, content-sized tabs, right edge aligned within 0.5 px.                                                                                           | PASS   |
| "Right-click and keyboard invocation open a menu containing Rename and Delete; dismissal and focus behavior are verified."   | Structure tests cover right-click, both keyboard shortcuts, arrow navigation, Escape, outside dismissal, and focus return; browser verifies Shift+F10 and Escape.                                                      | PASS   |
| "Rename persists a unique title while retaining workflow identity, scope, active selection, and saved document history."     | Pane history regression verifies the versioned save payload, unchanged identity/scope, selected renamed tab, retained dirty text, no document reload or revision writes; browser rename/restore preserves editor text. | PASS   |
| "Empty, duplicate, and oversized names are rejected; cancel and failed persistence do not discard the prior title."          | Structure tests verify invalid names, self-title exemption, prefilled selection, cancellation, save failure, and retry.                                                                                                | PASS   |
| "Delete uses the dirty guard and preserves saved data; Generate remains available after removing the final tab."             | Pane history verifies Cancel, Save & switch, preserved revisions, and enabled Generate with no tabs. The full-stack content-generation browser fixture verifies fresh discovery from an empty plan.                    | PASS   |
| "Light/dark desktop and narrow-pane browser checks show contained menus and controls with no overlap or spacing regression." | Light/dark screenshots, 900/700 px window checks, and a 315 px guide row verify contained controls/menus and right alignment.                                                                                          | PASS   |
| "Focused tests and required repository quality, test, and build gates have empirical evidence before marking Shipped."       | 56 focused tests pass; `npm run check`, `npm test` (109 files, 754 tests), and `npm run build` pass.                                                                                                                   | PASS   |

## Technical Notes

- Extend `GuideDocumentStructure`, `GuidePane`, and `useGuideCollection`; reuse `HistoryMenu`, the name modal, and `saveWorkflowPlan`.
- No new IPC channel, database migration, or independent rename persistence path is needed.

### Reorderable tab-strip verification

- Browser checks using the real `GuidePane` and `useGuideCollection` with deterministic desktop storage pass in light/dark at 640, 420, and 340 px. The tab row has a bottom divider, the active tab has no bottom border and covers the divider, top corners are rounded and bottom corners square, and Plus is contained at the right edge with no count.
- Native drag/drop saves the new order, reopening restores it, and keyboard reordering preserves focus. Right-click still exposes only Rename/Delete, with Escape dismissal and focus restoration. A 24-tab list remains scrollable.
- Structure and hook tests cover internal versus unrelated drops, keyboard moves, disabled controls, identity/scope/document-link preservation, no-op/invalid moves, failure and retry. Pane history verifies that reordering does not reload, save, discard, or switch a dirty active document.
- A database regression verifies workflow order after reopening while generated documents, drafts, and revision contents stay unchanged. All 110 test files / 764 tests pass under the matching Electron Node runtime.

### Compact header verification

- Browser checks using `GuidePane` with deterministic hook fixtures pass in light/dark at pane widths of 640, 420, and 340 px: the 12 px flow title, switch, and 32 px Generate button share a vertical center and remain contained without overlap. Screenshots were inspected.
- Space and Enter toggle Combine/Split; Combine hides the workflow row, and Split restores it. The flow dropdown remains usable, 24 tabs scroll within the pane, and busy generation disables the switch and action while exposing the spinner and `aria-busy` state.
- Component tests cover switch semantics, both mode requests, disabled changes, Generate's accessible name/tooltip, and pending state. Existing history tests exercise the switch while retaining dirty-document guards and independent saved history.
- Required checks and production build pass. All 110 Vitest files / 758 tests pass under the matching Electron Node runtime; exported-page hydration/navigation checks also pass.

### Earlier single-row tab styling verification

- Browser checks using the actual structure component and owning styles pass in light/dark at row widths of 600, 420, and 315 px: tab list and controls share a vertical center, remain contained, and do not overlap. Screenshots were inspected.
- The selected tab has an accent border and fill, while inactive tabs retain their own rounded border and neutral background. A 24-workflow list scrolls horizontally, including End/Enter navigation to the final tab and keyboard context-menu dismissal with focus restoration.
- Existing structure and pane-history regressions pass (22 tests); mode changes, busy controls, Rename/Delete, and the workflow-name modal retain their behavior.

- The pane-history test waits for the editor reset after deleting the final workflow, rather than assuming it finishes in the same render as the split count.
- `npm run check`, `npm run build`, and exported-page browser checks pass. All 109 Vitest files / 754 tests pass under Electron's Node runtime, matching the installed native SQLite binding without rebuilding it while Path is running.

## Changed Files

- [apps/renderer/src/components/GuideDocumentStructure.tsx](../apps/renderer/src/components/GuideDocumentStructure.tsx)
- [apps/renderer/src/components/GuidePane.tsx](../apps/renderer/src/components/GuidePane.tsx)
- [apps/renderer/src/hooks/useGuideCollection.ts](../apps/renderer/src/hooks/useGuideCollection.ts)
- [apps/renderer/src/styles/components/GuideDocumentStructure.css](../apps/renderer/src/styles/components/GuideDocumentStructure.css)
- [apps/renderer/test/GuideDocumentStructure.test.tsx](../apps/renderer/test/GuideDocumentStructure.test.tsx)
- [apps/renderer/test/GuidePaneHistory.test.tsx](../apps/renderer/test/GuidePaneHistory.test.tsx)
- [packages/shared/messages/en.json](../packages/shared/messages/en.json)
- [README.md](../README.md)
- [.agents/README.md](../.agents/README.md)
- [specs/DocumentTabActions.md](DocumentTabActions.md)

## Out of Scope

- Deleting saved documents, rewriting Markdown headings or contents, changing grounded workflow scopes, or adding generation behavior.
- Bulk actions, new tab toolbars, changing other menus, or unrelated layout and runtime fixes.
