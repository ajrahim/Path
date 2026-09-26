# FirstRunOnboarding

Status: Active

## Goal

On first launch, and after **Clear all data and settings**, the workspace opens a short carousel
that checks AI model setup and explains how to record, review, and generate documents. Users can
skip it at any point.

## User Experience

1. The workspace opens with no stored onboarding completion and no active recording.
2. A modal carousel shows five steps: Welcome, AI setup, Record, Review, and Generate.
3. The user moves with Next/Back, the step dots, or the Left/Right arrow keys.
4. The AI step shows whether the Visual and Text models are ready, and why one is not
   (Ollama unavailable, model not installed, API key missing, CLI tool unavailable, or none chosen).
   A compact form keeps both model selectors, Check again, Get Ollama, and Add API key visible
   together in ready and unconfigured states. Model names appear once, in their selectors.
   The existing model chooser opens over the step rather than extending its height, so users
   can choose installed local models or configured cloud models without scrolling the tour.
5. Record, Review, and Generate each lead with the outcome and two concise benefits.
   The Record step also shows the saved recordings folder; **Choose folder** opens the native
   directory chooser and displays the new location after it saves. Cancel keeps the current
   location, and failures show an inline error. Browser preview falls back to Storage settings.
   Speech-model downloads, imports, projects, and version-history details stay in their existing
   product surfaces rather than extending the introductory tour.
6. Skip, Escape, Done, and **Start first recording** close the carousel and record completion.
   **Start first recording** then opens the existing source dialog.
   Done replaces Skip in the same header button on the final step; the footer keeps the
   primary recording action separate from dismissal.

## Requirements

- Completion is stored in renderer `localStorage` as `path.onboarding`. The existing reset
  clears browser storage, so the carousel returns after a reset.
- Model readiness reuses `useAiModels` and `useCliTools`. Model selection reuses `LocalModelSelect`
  and the existing typed settings update; API keys are still entered in Settings.
- Arrow keys inside the model search or picker do not navigate the carousel. Escape closes an
  open model picker first without finishing onboarding. Moving keyboard focus outside the picker
  also closes it so it cannot cover the next focused control.
- Choosing a folder reuses `settings.chooseRecordingsDirectory`; pending operations cannot
  overwrite a newer request or update a slide after it unmounts.
- The Ollama link is an ordinary external link; the main window opens it in the system browser.
- If an active recording starts, the carousel is hidden without recording completion.
- A failed completion write still closes the carousel for the current session.
- The carousel follows Path's type, color, and button tokens. The welcome step uses a decorative
  screen-to-document illustration with light/dark assets; later steps use centered headings,
  semantic icons, and concise benefit cards. The 620px modal keeps content vertically balanced
  and the footer in place. Compact layouts reduce decorative space so all five steps fit without
  scrolling. The chooser is bounded to the slide; only its potentially long model catalog can
  scroll independently.

## Acceptance Criteria

- [x] The carousel opens when `path.onboarding` is absent and not when it is `complete`.
- [x] Skip, Escape, Done, and Start first recording each store completion and close.
- [x] Next, Back, step dots, and arrow keys change steps; the current step is announced.
- [x] Ready, Ollama unavailable, model missing, key missing, and CLI states render their messages.
- [x] Add API key opens Settings > API Keys when setup is needed.
- [x] Ready and unconfigured models keep selectors and provider setup actions visible together.
- [x] Check again updates readiness guidance without expanding a separate setup panel.
- [x] All five steps fit without scrolling at 776×686, 555×598, and 390×560; opening a model
      chooser does not increase the slide's scroll height or hide navigation.
- [x] Choose folder saves a location through the desktop chooser and retains it on cancel/error.
- [x] Done replaces Skip in the header without moving dismissal to the footer.
- [x] The Ollama link targets `https://ollama.com/download` in a new window.
- [x] Light and dark themes and reduced motion are respected.

## Out of Scope

- Replaying the carousel from Settings.
- Entering API keys or installing Ollama models directly in the carousel.
- New IPC channels, database schema, or desktop settings fields.
- Changes to the empty-workspace welcome screen.

## Verification

- `OnboardingDialog.test.tsx`: step navigation, focus, Skip/Escape/Done/Start, readiness messages,
  setup options following readiness changes, model selection, nested picker keyboard behavior,
  the Ollama link, API key settings, folder selection/cancel/error, and a browser preview without
  the bridge.
- `ModelReadiness.test.ts`: every readiness state, including CLI text mode.
- `OnboardingHook.test.ts`: stored completion and a failed storage write.
- `WorkspaceOnboarding.test.tsx`: first launch, Start first recording opening the source dialog,
  Settings section requests, and hiding during an active recording without storing completion.
- `node tests/RendererPages.mjs`: the exported home page opens onboarding in a fresh profile, Skip
  dismisses it, and the workspace does not show it again.
- The refreshed exported workspace was inspected in the in-app browser at desktop and compact
  sizes in light/dark themes. All slides fit without scrolling and keep navigation visible.
  Back, step indicators, Escape,
  and Start first recording were exercised. Console errors/warnings: none.
- Model selection and folder save/cancel/error flows passed component tests with desktop bridge
  mocks. The browser model picker opens, search arrows keep the current step, and Escape closes
  only the picker. The browser folder action opens Storage settings. Done and Skip share the
  same measured header position.
- The full Vitest suite passed: 669 tests across 105 files. An isolated source copy preserves the
  running application's Electron SQLite module.
- Reduced motion disables slide, loading-icon, and step-indicator animation in the owner stylesheet.
- `npm run check` and `npm run build` pass.

Not verified: opening the Ollama link from the packaged Electron window. It relies on the main
window's existing `setWindowOpenHandler`, which sends http(s) links to the system browser.
The native folder chooser and real provider/model writes were not exercised against the user's
live profile in this pass.
