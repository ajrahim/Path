# Document deployment to coding CLIs

Status: Active

## Behavior

The document pane places a **Deploy to CLI** section below the versions/Save/Export row. The compact `CLI | Model | Reasoning` selectors are always visible below the title, with the **Deploy** button beside the title. There is no Auto switch. The selector lists connected CLI tools and their reported models/efforts; deployment preferences are independent from the header's documentation AI choice. **Context Folder** chooses and remembers the local working directory. When documentation uses a CLI, that folder is also available for read-only document context.

Deploy sends the current editor text, including unsaved edits, to an interactive coding CLI in the selected folder. It is disabled while document work is busy, when previewing a previous version, or without a valid model, folder, and nonempty document. Selecting options or opening a recording never deploys. Duplicate clicks are blocked while launching; launch failures are shown without automatic retries.

[`pathai://generate`](AppLinks.md#deployment-choices) supports `auto=true/false` and per-request `cli`, `model`, `reasoning`, and `contextFolder` choices. Automatic deployment runs in the desktop orchestrator after video/activity processing, supplied Logs/Elements imports, and successful document generation and persistence. It does not depend on a mounted renderer. Failure before that point prevents deployment. Request choices are captured before import and do not overwrite the row's saved preferences.

## Ownership and boundaries

- `CliToolService` owns independent saved deployment preferences and validates connected tools and current catalogs. `PathAppLink` parses URL fields; `GenerateLinkService` sequences automatic work. Typed preload IPC validates manual requests in `RegisterIpc`.
- `CliDeployment` creates a bundle in Path's CLI work directory containing `document.md`, extracted embedded images, and launch arguments in JSON. The agent receives a short instruction to read the document and its images. Arbitrary renderer commands or executable paths are not accepted.
- The Windows launcher starts PowerShell with a fixed command that reads the payload as data and invokes the known executable with argument values. Document text is never evaluated as shell code. Terminal launch preserves the CLI's standard approval/authentication behavior and does not bypass its sandbox.
- Deployment opens a visible interactive terminal. `Opened in terminal` means the terminal started; it does not mean the coding work or a website deployment completed. Bundles remain available for the session under Path's resettable app data. Windows is supported; native macOS/Linux launch strategies are not implemented.
- Initial support uses the existing Codex, Claude Code, GitHub Copilot, and Muse connections. Model lists are discovered, not hardcoded. CLI document generation remains read-only; deployment is the explicit handoff to a coding session.

## Verification

Tests cover selection independence and persistence, folder requirements, unsupported model/effort rejection, URL overrides, default `auto=false`, full-workflow ordering, failed generation preventing launch, argument construction for each CLI, image bundles, shell-data separation, and renderer manual launch/error behavior. Native agent implementation, external publishing, and authenticated agent completion are not inferred from launcher tests.
