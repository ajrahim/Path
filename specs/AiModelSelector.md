# AI Model Selector

Status: Shipped

## Goal

One model menu that shows true Ollama availability for local models and browsable OpenRouter models with pricing, keeping direct provider keys as advanced options and leaving the selector decoupled for future library extraction.

## User Experience

1. User opens the model menu from its existing trigger and placement.
2. Local section shows Ollama daemon status (running/down plus endpoint); each model shows size, recency, and a loaded indicator when resident in memory.
3. A saved selection whose model is no longer installed shows a stale warning instead of failing silently at generation time.
4. API section lists OpenRouter models with vendor, context length, and per-1M-token input/output pricing before any key is configured; selecting one routes to key setup.
5. Configured direct providers (Anthropic, OpenAI, Google) keep their existing expandable lists; refresh reloads local, direct, and OpenRouter catalogs together.
6. Search filters across local models, OpenRouter models, and direct provider models.

## Requirements

- Distinguish Ollama daemon down, no vision models installed, and models installed.
- Fetch the OpenRouter model catalog live on refresh with a short in-memory cache; render pricing from the response.
- Add OpenRouter as a fourth API provider reusing the encrypted credential store and chat-completions path.
- Keep direct provider discovery, generation, and key management behavior unchanged.
- Isolate the selector UI and catalog hook behind a provider interface with no desktop or Electron imports.

## Acceptance Criteria

- [x] Ollama stopped renders a down status row; Ollama running with zero vision models renders an empty state distinct from the down state.
- [x] Installed local models display size and modified recency from discovery data.
- [x] Selecting an OpenRouter model without a key opens Settings key setup; with a key it saves and generates.
- [x] Direct provider models remain selectable and generate exactly as before this change.
- [x] No file in the selector UI or catalog hook imports desktop, Electron, or preload modules.
- [x] IPC payloads for new catalog fields validate under strict Zod schemas.

## Constraints

- Renderer stays sandboxed; discovery and keys flow through typed preload IPC only.
- API keys encrypted at rest via Electron `safeStorage`; renderer receives presence flags only.
- No silent provider fallback; an unavailable selection surfaces an explicit state.
- OpenRouter catalog cache lives in main-process memory with a bounded TTL (minutes, not hours).
- Existing trigger, placement, and visual language are preserved; added rows match current styling.

## Technical Notes

- Reuse `apps/renderer/src/components/LocalModelSelect.tsx` and `apps/renderer/src/hooks/useAiModels.ts`.
- Extend `apps/desktop/src/ai/SelectedAiService.ts` discovery plus `ProviderModels.ts` with an OpenRouter source (`GET /api/v1/models`, `POST /api/v1/chat/completions`).
- Extend `OllamaClickActionAnalyzer.listModels()` to return size, modified time, and loaded state (`/api/tags`, `/api/ps`).
- Extend `AvailableAiModels` and key status in `packages/shared/src/Contracts.ts` with IPC schemas in `Ipc.ts`.

## Out of Scope

- Physical extraction or publishing of a selector library package.
- Usage, spend, or billing dashboards beyond per-model list pricing.
- Removing or migrating away direct provider integrations.
- Non-vision local models and automatic Ollama model downloads.
