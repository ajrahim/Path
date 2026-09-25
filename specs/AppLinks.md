# Local application links

Status: Active

## Scope and behavior

`pathai://` opens or restores Path. `pathai://generate` creates a new recording from an existing local video, using the same managed media, transcription, timeline import, document, and Projects services as the application. It does not start screen capture.

`pathai://status` (also `pathai://status/`) requests a native "Path is running." notification. It accepts no query fields, imports no files, and starts no generation. Cold status requests wait for application services to initialize; warm requests respond immediately even while a generation job is running. Opening the link can launch Path if it is closed, so it confirms availability after activation, not whether the app was running beforehand. It does not return a machine-readable HTTP/JSON response, and notification visibility depends on OS settings.

The primary Electron instance receives cold-launch arguments, second-instance arguments, and macOS `open-url` events. Accepted generation links wait until storage and services are ready and run sequentially; read-only status requests bypass this work queue. Quit waits for accepted link work before closing its dependencies.

## Generate query fields

Keys use the application's camelCase convention and are case-sensitive. Old spellings such as `video_path`, `document_type`, `log`, and `elemets` are not aliases.

| Key            | Value and behavior                                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videoPath`    | Required absolute path to a readable, nonempty local video file. Encode it as a query value, not as a `file://` URL. Path copies it into the recording's managed directory; the original is unchanged.                                                                           |
| `title`        | Optional recording title, at most 120 characters. Defaults to the source filename without its extension.                                                                                                                                                                         |
| `type`         | Optional string, at most 120 characters, reserved for future use. Accepted but neither persisted nor used to change behavior.                                                                                                                                                    |
| `documentType` | `spec`, `help`, or a prompt name from Settings, matched without case sensitivity. `spec` and `help` use the current instructions of those defaults, including edits. If omitted, uses the currently selected prompt. The link does not change the application's selected prompt. |
| `folder`       | Optional Projects folder name, at most 80 characters. Reuses an existing case-insensitive match or creates it, then places the recording there. Multiple matching folders reject the request before media import. This is a library folder, not a filesystem path.               |
| `auto`         | `true` or `false`; defaults to `false`. Both values import and process the video, transcribe its audio when present, and import supplied logs/elements. `true` then generates a document using the selected Text model or CLI tool.                                              |
| `logPath`      | Optional absolute path to a local timestamped log file, using the existing Logs importer and configured size limit.                                                                                                                                                              |
| `elementsPath` | Optional absolute path to a local timestamped elements file, using the existing Elements importer and configured size limit.                                                                                                                                                     |

For nullable fields (`title`, `type`, `documentType`, `folder`, `logPath`, and `elementsPath`), omission, an empty value, or the literal `null` means no supplied value. This does not apply to required `videoPath` or to `auto`, which only accepts `true` or `false` when present.

Build links with `URLSearchParams` so spaces, `&`, `+`, and non-ASCII text are encoded correctly:

```js
const query = new URLSearchParams({
  videoPath: "C:/Videos/demo.mp4",
  title: "Demo walkthrough",
  documentType: "help",
  folder: "Tutorials",
  auto: "true",
  logPath: "C:/Videos/demo.log",
  elementsPath: "C:/Videos/demo-elements.jsonl",
});

const link = `pathai://generate?${query.toString()}`;
```

Omit optional file keys when no corresponding file exists. A minimal link is `pathai://generate?videoPath=C%3A%2FVideos%2Fdemo.mp4`.

## Processing and timing

Video processing creates an owned source copy, playable video, and thumbnail. Speech becomes transcript activity. An arbitrary source video has no Path mouse-capture telemetry, so importing it cannot reconstruct left/right clicks or click screenshots.

Imported media uses its creation timestamp when available; otherwise the starting timestamp is approximated from the source file's modification time minus video duration. File copies or edits can make that fallback inaccurate. Review the Logs/Elements timeline and adjust its offset when necessary; see [recording logs and elements](RecordingLogsAndElements.md).

Automatic document generation waits for completed video and activity processing and the supplied imports. It stops if activity processing is not ready or if a supplied import has no rows within the video's time range. Generation uses the existing document service, so successful output becomes a stored document revision. Files, prompts, and ambiguous folder names are validated before starting the import. A later import or generation failure retains the recording for review and manual recovery.

## Notifications and workspace selection

Path requests native system notifications when starting, processing, and completing the requested workflow, and on failure. Clicking a notification restores Path and selects its recording when an ID is available. Actual notification display depends on OS support and the user's notification settings; notification failures do not undo completed recording work.

The workspace refreshes recording history, Projects folders, and imported timeline data through typed preload events. A pending open request covers links completed before renderer hydration. Selecting a linked recording uses the existing unsaved-document confirmation; it does not reload the page or discard an editor draft.

## Registration and compatibility

Electron registers `pathai` at desktop startup. Development registration points at the Electron executable and the desktop application's directory. The packaged application's `protocols` configuration declares the same scheme for installers. Rebuild and restart the desktop app after adding this feature; an already-running older build has neither the handler nor the registration. Installed use requires an installer/build containing this configuration.

Windows is the primary runtime target. macOS event handling and packaging declarations exist, but native end-to-end validation remains outstanding, and the bundled transcription runtime currently supports Windows x64 only. Protocol declarations do not establish complete cross-platform support.

## Boundaries and exclusions

- Only local absolute file paths are supported; remote video URLs, UNC/network shares, device paths, and URL credentials are rejected. No arbitrary command or shell execution is supplied by a link.
- The parser rejects unknown or repeated keys, malformed encoding, unsupported routes, ports, fragments, and control characters. The maximum complete URL length is 16,384 characters; individual file paths are limited to 4,096 characters.
- Existing log/element formats and the configured import size limit apply. This feature adds no new file format or activity telemetry import.
- No webhook, HTTP server, link-carried API secret, new recording type behavior, or legacy query-key aliases are included.

## Ownership and verification

The parser and delivery lifecycle belong to [PathAppLink](../apps/desktop/src/links/PathAppLink.ts) and [PathProtocol](../apps/desktop/src/links/PathProtocol.ts). [GenerateLinkService](../apps/desktop/src/links/GenerateLinkService.ts) coordinates the existing services; [RecordingController](../apps/desktop/src/recording/RecordingController.ts) owns video import; [PathLinkNotifications](../apps/desktop/src/links/PathLinkNotifications.ts) owns native notices. [Main](../apps/desktop/src/Main.ts), [Preload](../apps/desktop/src/Preload.ts), and [WorkspacePage](../apps/renderer/src/pages/WorkspacePage.tsx) connect delivery to window selection.

Focused coverage lives in `PathAppLink.test.ts`, `PathProtocol.test.ts`, `GenerateLinkService.test.ts`, `RecordingImportVideo.test.ts`, `PathLinkNotifications.test.ts`, `ProjectRepository.test.ts`, and `WorkspaceAppLinks.test.tsx`. Acceptance requires valid/invalid query handling; cold/warm delivery; managed-copy ownership; processing and import ordering; prompt/folder resolution; automatic generation readiness; notifications; and unsaved-draft-safe selection.

Validation on 2026-09-25 passed the feature tests, workspace typechecks, production renderer/desktop build, architecture and unused-code checks, and formatting/lint for changed files. Windows registration was verified with Electron's default-protocol query and the registered launch command. A real Electron smoke check delivered cold and warm launches in order using an isolated profile; bundled FFmpeg checks processed audio and silent video. An integrated URL-to-document check used real FFmpeg, the SQLite worker, timeline imports, folder assignment, and document revisions, confirming source preservation and persistence after reopening the database; its AI response and native UI boundaries were stubbed. Notification API calls are tested, but visible OS delivery and macOS runtime behavior are not verified.

The full Vitest run has six unrelated failures in `OllamaClickActionAnalyzer.test.ts` (a reused response body), `RecordingProjectsUi.test.tsx`, and `RecordingRenameUi.test.tsx` (expectations for removed action buttons). Existing formatting/lint issues outside this change also prevent a clean `npm run check`. These are not recorded as passing checks.
