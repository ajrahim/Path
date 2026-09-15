# Current state

Source baseline: 2026-09-14.

| Capability          | Current Status                                                                                                                                 | Primary Source Ownership                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Screen Capture**  | Display, window, and custom region capture; optional microphone audio and global mouse click recording; post-stop MP4/AV1 conversion.          | `apps/desktop/src/recording/RecordingController.ts`, `apps/renderer/src/lib/CaptureEngine.ts`                                      |
| **Activity Review** | Local recording history, video playback, timestamped click screenshots, dialogue transcript editing, and activity deletion.                    | `apps/renderer/src/pages/WorkspacePage.tsx`, `apps/renderer/src/components/RecordingPane.tsx`, `packages/database/src/`            |
| **Doc Generation**  | Built-in Help Guide and Spec Document flows; custom user-defined instruction prompts; Markdown editing, copy, and export.                      | `apps/renderer/src/lib/InstructionFlows.ts`, `apps/renderer/src/components/GuidePane.tsx`, `apps/desktop/src/ai/DocumentPrompt.ts` |
| **AI Integration**  | Local Ollama vision/text models; Anthropic, OpenAI, and Google Gemini cloud models; local Windows whisper.cpp audio transcription (`tiny.en`). | `apps/desktop/src/ai/SelectedAiService.ts`, `packages/transcription/src/WhisperCppTranscriptProvider.ts`                           |
| **Local Storage**   | SQLite metadata (`database.sqlite`), managed local media folders, encrypted provider keys (`safeStorage`), and renderer preferences.           | `packages/database/src/Schema.ts`, `apps/desktop/src/storage/`                                                                     |

## Operational limits and constraints

- **Click Analysis:** Maximum 200 clicks analyzed per recording session.
- **Document Context:** Up to 300 chronological activity entries included in generation prompts; cloud AI completion requests 2,048 tokens.
- **Markdown Drafts:** Markdown is exported or copied directly; per-recording drafts are not autosaved in SQLite.
- **Transcription:** Local whisper.cpp runs on Windows x64 using pinned `ggml-tiny.en.bin`.
- **Packaging:** Windows NSIS executable installer generated via `npm run package` (`release/Path-<version>.exe`).
