import type { AiModelSelection, AiProvider, AvailableAiModels } from "@path/shared";
import type { DesktopSettingsService } from "../settings/DesktopSettingsService";
import type { AiCredentialStore } from "../storage/AiCredentialStore";
import { listProviderModels } from "./ProviderModels";
import type { OllamaClickActionAnalyzer } from "./OllamaClickActionAnalyzer";
import {
  normalizeClickDescription,
  prepareClickAction,
  type ClickActionAnalysisInput,
  type ClickActionAnalyzer,
} from "./OllamaClickActionAnalyzer";

interface ApiTextResponse {
  text: string;
}

const API_REQUEST_INTERVAL_MS = 750;
const GOOGLE_REQUEST_INTERVAL_MS = 13_000;
const MAX_API_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 120_000;

export class AiRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "AiRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// Routes generation through the saved selection and owns pacing shared by cloud requests.
export class SelectedAiService implements ClickActionAnalyzer {
  private apiRequestQueue = Promise.resolve();
  private nextApiRequestAt = 0;

  constructor(
    private readonly settings: DesktopSettingsService,
    private readonly credentials: AiCredentialStore,
    private readonly ollama: OllamaClickActionAnalyzer,
  ) {}

  async listModels(): Promise<AvailableAiModels> {
    // Discovery can list available backends independently; generation never changes the selected source.
    const [local, status] = await Promise.all([
      this.ollama.listModels().catch(() => []),
      this.credentials.getStatus(),
    ]);

    const apiGroups = await Promise.all(
      (["anthropic", "openai", "google"] as const).map(async (provider) => {
        if (!status[provider]) return [];

        const key = await this.credentials.get(provider);

        if (!key) return [];

        return listProviderModels(provider, key)
          .then((models) =>
            models
              .filter((model) => supportsImages(provider, model.id))
              .map((model) => ({ ...model, provider })),
          )
          .catch(() => []);
      }),
    );

    return { api: apiGroups.flat(), local };
  }

  listLocalModels() {
    return this.ollama.listModels();
  }

  async analyze(input: ClickActionAnalysisInput): Promise<string> {
    const selection = this.settings.get().aiModelSelection;

    if (selection.source === "local") {
      this.ollama.setModel(selection.modelId);

      return this.ollama.analyze(input);
    }

    const prepared = await prepareClickAction(input);
    const result = await this.requestApi(selection, prepared.prompt, 128, prepared.imageBase64);

    return normalizeClickDescription(result.text, input.button);
  }

  async generateText(prompt: string): Promise<string> {
    const selection = this.settings.get().aiModelSelection;

    if (selection.source === "local") {
      this.ollama.setModel(selection.modelId);

      return this.ollama.generateText(prompt);
    }

    return (await this.requestApi(selection, prompt, 2_048)).text;
  }

  private async requestApi(
    selection: Extract<AiModelSelection, { source: "api" }>,
    prompt: string,
    maxTokens: number,
    imageBase64?: string,
  ): Promise<ApiTextResponse> {
    const key = await this.credentials.get(selection.provider);

    if (!key) throw new Error(`No ${selection.provider} API key is configured`);

    return this.enqueueApiRequest(selection.provider, () => {
      switch (selection.provider) {
        case "anthropic":
          return requestAnthropic(key, selection.modelId, prompt, maxTokens, imageBase64);
        case "openai":
          return requestOpenAi(key, selection.modelId, prompt, maxTokens, imageBase64);
        case "google":
          return requestGoogle(key, selection.modelId, prompt, maxTokens, imageBase64);
      }
    });
  }

  private enqueueApiRequest<T>(provider: AiProvider, request: () => Promise<T>): Promise<T> {
    const run = async () => {
      const waitMs = Math.max(0, this.nextApiRequestAt - Date.now());

      if (waitMs > 0) await delay(waitMs);

      try {
        return await request();
      } finally {
        this.nextApiRequestAt =
          Date.now() +
          (provider === "google" ? GOOGLE_REQUEST_INTERVAL_MS : API_REQUEST_INTERVAL_MS);
      }
    };

    const queued = this.apiRequestQueue.then(run, run);

    // Keep the queue usable after a failed request while returning that failure to its caller.
    this.apiRequestQueue = queued.then(
      () => undefined,
      () => undefined,
    );

    return queued;
  }
}

async function requestAnthropic(
  key: string,
  model: string,
  prompt: string,
  maxTokens: number,
  image?: string,
): Promise<ApiTextResponse> {
  const content: unknown[] = [];

  if (image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: image },
    });
  }

  content.push({ type: "text", text: prompt });
  const body = await requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": key,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: "user", content }],
    }),
  });

  const blocks = record(body)?.content;
  const text = Array.isArray(blocks)
    ? blocks
        .map((block) => record(block)?.text)
        .filter((value): value is string => typeof value === "string")
        .join("\n")
    : "";

  return { text };
}

async function requestOpenAi(
  key: string,
  model: string,
  prompt: string,
  maxTokens: number,
  image?: string,
): Promise<ApiTextResponse> {
  const content = image
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${image}` } },
      ]
    : prompt;

  const body = await requestJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: "user", content }],
    }),
  });

  const choices = record(body)?.choices;
  const first = Array.isArray(choices) ? record(choices[0]) : null;

  return { text: String(record(first?.message)?.content ?? "") };
}

async function requestGoogle(
  key: string,
  model: string,
  prompt: string,
  maxTokens: number,
  image?: string,
): Promise<ApiTextResponse> {
  const parts: unknown[] = [];

  if (image) {
    parts.push({ inline_data: { mime_type: "image/png", data: image } });
  }

  parts.push({ text: prompt });
  const body = await requestJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: maxTokens,
          ...googleThinkingConfig(model),
        },
      }),
    },
  );

  const candidates = record(body)?.candidates;
  const candidate = Array.isArray(candidates) ? record(candidates[0]) : null;
  const partsOut = record(candidate?.content)?.parts;
  const text = Array.isArray(partsOut)
    ? partsOut
        .map((part) => record(part)?.text)
        .filter((value): value is string => typeof value === "string")
        .join("\n")
    : "";

  return { text };
}

function googleThinkingConfig(model: string): Record<string, unknown> {
  if (/^gemini-2\.5-(?:flash|flash-lite)/.test(model)) {
    return { thinkingConfig: { thinkingBudget: 0 } };
  }

  if (/^gemini-(?:3|[4-9])/.test(model)) {
    return { thinkingConfig: { thinkingLevel: "low" } };
  }

  return {};
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  // Bound retries and honor provider delays; persistent throttling is returned to the batch owner.
  for (let attempt = 0; attempt < MAX_API_REQUEST_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      if (
        attempt + 1 >= MAX_API_REQUEST_ATTEMPTS ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }

      await delay(retryDelayMs(null, null, attempt));
      continue;
    }

    const body: unknown = await response.json().catch(() => null);

    if (response.ok) return body;

    if (
      isRetryableStatus(response.status) &&
      (response.status === 429 ? attempt === 0 : attempt + 1 < MAX_API_REQUEST_ATTEMPTS)
    ) {
      await delay(retryDelayMs(response, body, attempt));
      continue;
    }

    const message = record(record(body)?.error)?.message ?? record(body)?.message;

    if (response.status === 429) {
      throw new AiRateLimitError(
        typeof message === "string" ? message : "AI request rate limited",
        retryDelayMs(response, body, attempt),
      );
    }

    throw new Error(
      typeof message === "string" ? message : `AI request failed (${response.status})`,
    );
  }

  throw new Error("AI request failed after retrying");
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(response: Response | null, body: unknown, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");

  // Retry-After may be seconds or an HTTP date; all internal delays use milliseconds.
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const requestedDelay = Number.isFinite(seconds)
      ? seconds * 1_000
      : Date.parse(retryAfter) - Date.now();

    if (Number.isFinite(requestedDelay) && requestedDelay > 0) {
      return Math.min(requestedDelay, MAX_RETRY_DELAY_MS);
    }
  }

  const error = record(body)?.error;
  const message = record(error)?.message ?? record(body)?.message;

  if (typeof message === "string") {
    const seconds = /retry in\s+([\d.]+)s/i.exec(message)?.[1];

    if (seconds) {
      return Math.min(Math.ceil(Number(seconds) * 1_000), MAX_RETRY_DELAY_MS);
    }
  }

  return Math.min(1_000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function supportsImages(provider: "anthropic" | "openai" | "google", modelId: string): boolean {
  if (provider === "anthropic") return /^claude-(?:3|[4-9])/.test(modelId);
  if (provider === "openai") {
    return /^(?:gpt-(?:4o|4\.1|4-turbo|5)|chatgpt-4o)/.test(modelId);
  }

  return /^gemini-/.test(modelId);
}
