# CLI text generation

Status: Shipped

## Behavior

The header's Text picker has Text Model and CLI Tool tabs. CLI Tool selects an installed, connected CLI, one of its reported models, and an optional supported reasoning effort. The visual model stays independent. Settings has a separate CLI Tools page for Codex CLI, Claude Code, GitHub Copilot, and Facebook Muse. Connecting reuses the CLI's existing local sign-in; Path neither stores CLI credentials nor performs sign-in itself.

Connections and the selected CLI/model/effort persist in desktop settings. The CLI picker uses the same searchable, collapsible list pattern as the model picker. Each CLI header shows connection status. Clicking a model activates CLI text generation immediately; the checked model determines the active tool. A separate collapsible reasoning list follows the selected model and saves effort changes immediately. The menu remains open so both choices can be made together. Selecting Text Model returns to the existing API/local text selection. Disconnecting the active CLI returns to Text Model. A failed CLI request is surfaced without silently using another provider.

Context Folder is enabled when a connected CLI is selected. The native folder picker grants the folder for the current app session. Document updates can use that folder as reference context; users can remove it or choose another. The folder is retained across successful updates and reset with the recording. Image attachments still use the independent visual model for their descriptions.

## Ownership and boundaries

`CliTools` defines browser-safe shared contracts. `CliToolService` owns connection preferences, live catalogs, and folder grants. `CliProcess` owns bounded child processes and JSON-line transport; `CliCatalog` reads each CLI's reported capabilities; `CliGeneration` requests Markdown drafts. The preload bridge validates inputs in `RegisterIpc`. `SelectedAiService` routes text generation. `useCliTools` subscribes to revisioned snapshots; `CliToolPicker` and `CliSettings` own presentation.

Model catalogs come from Codex app-server, Claude's initialization response, Copilot ACP, and Muse's model/list response. Efforts come from per-model capability fields where available; Muse exposes its CLI-reported Meta effort choices. Copilot effort options are refreshed after model selection. Missing capabilities are not replaced with guessed model lists.

Children run without shell interpolation or visible windows, with time and output limits. Requests use temporary files or stdin and read-only tool configurations. Temporary request folders are removed after completion; active children are stopped on app shutdown. Context-folder requests must match a grant returned by the native picker.

## Scope and compatibility

Existing API/local selections, visual analysis, recordings, prompts, and themes retain their behavior. No new credential store, automatic sign-in, CLI installation, repository editing, or persistent agent conversation is included. Discovery supports native executables on PATH and common per-user Windows install locations; arbitrary custom executable paths are not configurable.

## Verification

Focused tests cover catalog parsing, model-dependent efforts, persistence, unavailable authentication, folder grants, provider routing, request validation, process timeout/shutdown, UTF-8 output, and renderer selection/navigation. Light and dark picker layouts were checked in a browser preview. Live local discovery and a minimal document request passed for Codex, Claude Code, and Facebook Muse. Copilot discovery reported authentication required; authenticated Copilot generation remains unverified.
