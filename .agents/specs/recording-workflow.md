# Recording, review, and document workflow

Status: Implemented baseline specification. Updated: 2026-09-14.

## Core workflow requirements

| ID          | Capability             | Observable Acceptance Criteria                                                                                                                                                   |
| ----------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **REC-01**  | Source Recording       | Starts capture for selected display/window/region with microphone and click options. Failed initialization immediately transitions state to failed and cleans up partial assets. |
| **REC-02**  | Authoritative Controls | Main window minimizes and floating recording toolbar appears upon start. Stop button has a 2-second arming guard to prevent residual click termination.                          |
| **REC-03**  | Stop & Processing      | Stop restores the main window and presents processing states while FFmpeg converts raw chunks into MP4 and Whisper transcribes audio.                                            |
| **REC-04**  | Synchronized Timeline  | Review list displays merged, seekable click events and transcript segments ordered by monotonic media timestamps.                                                                |
| **REC-05**  | Attached Edits         | Transcript text edits and deleted activities persist immediately to SQLite without modifying raw source media.                                                                   |
| **REC-06**  | Safe Deletion          | History deletion requires confirmation (or cancel/Escape); confirms purge of both SQLite rows and managed media files.                                                           |
| **DOC-01**  | Document Generation    | Generates Markdown using selected instruction flow and AI provider, providing title and bounded activity text as evidence.                                                       |
| **DOC-02**  | Flow Profiles          | Built-in **Help Guide** focuses on numbered steps; **Spec Document** generates structured improvement specs with REQ IDs, rationale, and acceptance criteria.                    |
| **DOC-03**  | Export & Copy          | Markdown drafts can be edited, copied to clipboard, or exported to disk (`.md`). Custom instructions save to user profile.                                                       |
| **DATA-01** | Managed Storage        | Storage location updates apply to future recordings while prior directories remain registered and readable.                                                                      |

## Operational boundaries

- **Security:** Renderer messages and parameters are strictly validated through Zod schemas. AI credentials remain encrypted in Electron `safeStorage`.
- **Privacy:** Cloud AI calls transmit only bounded text context and cropped click screenshots (no raw audio/video streams).
- **Processing Thresholds:** Maximum 200 clicks per recording; up to 300 chronological activity entries per document generation prompt.
