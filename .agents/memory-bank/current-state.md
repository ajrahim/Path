# Current state

Source baseline: 2026-09-14. These are implementation facts and known gaps, not a claim that native integration or release validation passed on this date. Recheck the linked owner when modifying a workflow.

| Area      | Current fact                                                                                                  | Source                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture   | Display/window/region capture, optional microphone and click capture, post-stop video processing              | [Recording controller](../../apps/desktop/src/recording/RecordingController.ts), [capture engine](../../apps/renderer/src/lib/CaptureEngine.ts)                                        |
| Review    | Recording history, video playback, click screenshots, transcript editing and activity deletion                | [Workspace page](../../apps/renderer/src/pages/WorkspacePage.tsx), [recording pane](../../apps/renderer/src/components/RecordingPane.tsx), [repositories](../../packages/database/src) |
| Documents | Help Guide, Spec Document, and local custom instruction flows; Markdown generation, editing, copy, and export | [Instruction flows](../../apps/renderer/src/lib/InstructionFlows.ts), [guide pane](../../apps/renderer/src/components/GuidePane.tsx)                                                   |
| AI        | Selected Ollama model or configured Anthropic/OpenAI/Google provider; local Windows whisper.cpp transcription | [Selected AI service](../../apps/desktop/src/ai/SelectedAiService.ts), [transcription](../../packages/transcription/src/WhisperCppTranscriptProvider.ts)                               |
| Storage   | SQLite metadata, separate managed media files, encrypted provider keys, renderer-profile preferences          | [Architecture](../architecture.md), [README](../../README.md#local-data)                                                                                                               |

Generated Markdown is not autosaved per recording. Export or copy a draft before changing recordings or closing the app. The database's document table does not establish an active document-persistence workflow.

System audio, user-facing pause/resume, thumbnails, partial-recording recovery, and signed installers are not complete capabilities. macOS targets exist, but complete native runtime and permissions validation remains outstanding. Linux has no configured installer target. Native platform support must be established by actual runs, not package configuration.

Playback loads the complete processed video into renderer memory. Click analysis is bounded to 200 clicks and document context to 300 ordered activity entries; cloud document output requests 2,048 tokens. Window capture lacks reliable window-relative hotspot coordinates. Long recordings, mixed-scale displays, and broader platform coverage need separate validation.

Keep transient task logs, private recording evidence, machine-specific setup, and credentials out of this public memory bank.
