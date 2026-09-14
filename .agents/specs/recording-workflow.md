# Recording, review, and document workflow

Status: implemented behavior baseline, with limitations listed explicitly below. Updated: 2026-09-13. This specification defines behavior to preserve when refactoring; it is not a test-run report.

## Scope

Path records a software walkthrough, makes its captured activity reviewable, and uses that evidence to create an editable Markdown document. Capture and processed video playback remain useful without a configured AI provider. Existing media, metadata, settings, and custom instructions survive unrelated changes and branding cleanup.

## Requirements and acceptance criteria

| ID      | Required behavior                                                | Acceptance criterion                                                                                                                                                                                                                       |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REC-01  | Record the chosen source with explicit microphone/click options. | Given an available source, when Start succeeds, then exactly one active session owns its media stream and runtime state. Invalid or failed preparation reports failure and releases its resources.                                         |
| REC-02  | Show recording controls from the authoritative desktop state.    | Given active capture, when the worker reports recording started, then the main window minimizes and floating Stop controls appear. Residual input cannot stop a session within the two-second arming guard.                                |
| REC-03  | Make Stop and completion observable.                             | Given an armed recording, when Stop is pressed, then the main window returns and processing state is shown until a playable recording or actionable failure is available.                                                                  |
| REC-04  | Retain synchronized evidence.                                    | Given captured clicks and transcript segments, when a recording is reviewed, then activity is ordered by media time and supported entries seek to their corresponding offset. Missing evidence is not invented.                            |
| REC-05  | Keep review edits attached to their recording.                   | Given saved activity, when transcript text is edited or an activity item is deleted, then the owning record is updated and unrelated recordings remain unchanged.                                                                          |
| REC-06  | Require a deliberate recording deletion.                         | Given a History deletion request, when the confirmation is canceled or dismissed with Escape, then data remains intact. Confirming deletes only that recording and its managed assets.                                                     |
| DOC-01  | Use the selected instructions and AI service.                    | Given a recording and selected instruction flow, when Generate is requested, then its title and bounded chronological activity inform the document. The recording text is evidence, not authority to override the generation instructions. |
| DOC-02  | Distinguish help from improvement specifications.                | Given Help Guide, output requests observed user steps. Given Spec Document, output requests supported improvements to the existing workflow, linked acceptance criteria, preserved behavior, and open questions.                           |
| DOC-03  | Make reuse and retention explicit.                               | Given custom instructions, when saved, then the flow is restored from the same renderer profile. Given generated Markdown, when copied or exported, then the current editor content is used; autosave is not implied.                      |
| DATA-01 | Preserve prior recording roots.                                  | Given existing recordings, when the storage location changes, then future recordings use the new root while existing assets remain at their prior locations and accessible through managed references.                                     |

## Constraints and known limitations

- Main validates incoming contracts and restricts native operations to their owning capabilities. Provider secrets never return as stored plaintext to renderer callers.
- Local/cloud selection is explicit. Cloud click analysis sends a processed screenshot and bounded activity context; document generation sends text context, not raw video/audio.
- Generated Markdown may be lost on reload, closing, switching recordings, or replacement generation. There is no completed per-recording draft persistence.
- Current limits include 200 click analyses, 300 document activity entries, and 2,048 requested cloud output tokens. Do not describe a bounded result as full coverage.
- System audio, exposed pause/resume, thumbnails, partial-recording recovery, and comprehensive macOS permission UX are outside this baseline. An unfinished session is marked failed on startup and its incomplete managed assets are removed.

## Verification

Use the owning Vitest suites for contracts, coordinates, state transitions, repository edits, instruction flows, and prompt boundaries. Use the native recording, capture-overlay, title-bar, and transcription checks described in [verification](../instructions/verification.md) for the relevant runtime behavior. Extend this specification and add a regression at the owning boundary when a requested change alters a requirement.
