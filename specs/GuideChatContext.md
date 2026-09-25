# Guide chat context

Status: Shipped

## Behavior

The chat composer uses a borderless plus button in place of its model and effort controls. Model selection remains in the header. The plus offers Add image and Add text, with removable attachment chips above the message. Up to four context items may accompany an update; a nonempty update request is still required.

Text context is limited to 20,000 characters per item. PNG, JPEG, and WebP images up to 5 MB are converted to PNG and resized to a maximum edge of 1600 pixels. Attachments remain in the local composer until Send. They are cleared after a successful update, retained after failure, and reset when changing recordings.

The desktop validates context through the shared IPC schema. The selected visual model describes image attachments; those descriptions and attached text become reference evidence for the selected text model's document update. Image-analysis errors stop the update rather than silently dropping context. No attachments are added directly to the document or persisted as separate files.

## Ownership and scope

Context Folder sits immediately after the plus. It is disabled with the tooltip "Connect a CLI in Settings" until a connected CLI is selected. The native picker grants a codebase folder for document updates; see [CLI text generation](CliTools.md) for connection, model, and reasoning selection.

`GuideChatInput` owns the request and attachment draft. `GuideChatContext` owns the plus menu and file selection; `GuideContextImage` performs browser image normalization. `useGuideDocument` forwards context through the existing guide update bridge. `SelectedAiService` handles visual analysis and text-model routing. `GuideContext` holds shared types and bounds.

File documents, remote URLs, image generation, provider changes, and persistent attachment libraries are outside this change.

## Verification

Renderer, hook, shared-schema, model-routing, and IPC tests cover attachment creation/removal, retry retention, request forwarding, limits, invalid payloads, and failures. Production build and focused lint pass. Browser preview verified real PNG conversion, text/image chips, submission, and light/dark presentation. Provider inference is mocked in tests; no live AI request was made.
