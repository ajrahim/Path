# Recording Workflow

Status: Shipped

## Goal

Record software walkthroughs with synchronized video, microphone audio, and mouse clicks, allowing users to review the timeline, edit transcripts, and generate Markdown help guides or engineering specs using local or cloud AI models.

## User Experience

1. User selects a capture source (display, window, or region) and clicks Start recording.
2. Main window minimizes and a floating toolbar appears with Stop controls (armed after 2 seconds).
3. User performs actions and speaks; system records screen chunks, clicks, and audio.
4. User clicks Stop; system converts video to MP4, transcribes audio, and analyzes click screenshots.
5. User reviews video and seekable timeline in History, edits transcripts, or deletes items.
6. User selects an instruction flow (Help Guide, Spec Document, or custom) and AI model, then generates, edits, copies, or exports Markdown.

## Requirements

- Support display, window, and region screen capture with microphone and global click hooks.
- Process captured video post-stop into local MP4 via FFmpeg and transcribe audio via local whisper.cpp.
- Maintain a seekable, chronological activity timeline combining click screenshots and transcript segments.
- Generate Markdown documents from recording context using local Ollama or configured cloud AI providers.
- Ensure all media files, database records, and API credentials remain strictly local and encrypted.

## Acceptance Criteria

- [x] Starting capture creates exactly one active session with selected video, audio, and click capture options.
- [x] Floating toolbar appears upon start with a 2-second arming guard preventing accidental premature stops.
- [x] Stopping capture restores the main window and transitions through processing states to a ready or failed state.
- [x] Review pane displays merged click events and transcript segments ordered chronologically by monotonic media timestamps.
- [x] Clicking any activity row seeks video playback directly to its timestamp.
- [x] Editing transcript text or deleting an activity updates SQLite records without altering source media.
- [x] Document generation requests use selected instruction presets and transmit only bounded text and click screenshots.
- [x] Generated Markdown can be copied to clipboard or exported directly to `.md` files.
- [x] Deleting a recording requires explicit confirmation and purges SQLite metadata alongside managed media assets.

## Constraints

- **Process Isolation:** Renderer runs sandboxed; desktop services are accessed exclusively via typed preload IPC (`window.desktop`).
- **Security:** AI provider API keys are encrypted at rest via Electron `safeStorage`.
- **Privacy:** Cloud AI calls never transmit raw video or audio files.
- **Resource Limits:** Maximum 200 clicks analyzed per recording; up to 300 activity entries in document generation prompts.

## Technical Notes

- Core state machine: `packages/recording-core/src/StateMachine.ts` and `SessionClock.ts`.
- Timeline correlation: `packages/timeline/src/Correlate.ts`.
- Media server: `apps/desktop/src/media/RecordingMediaServer.ts` with per-session token validation.
- SQLite repositories: `packages/database/src/RecordingRepository.ts`.

## Out of Scope

- Live video streaming or cloud video hosting.
- Multi-track video timeline editing.
- Automatic explicit saves. Saving stays a user action; unsaved text is kept as a recovery draft and revision history is durable ([Local persistence](../../specs/LocalPersistence.md)).
- System audio loopback capture.
