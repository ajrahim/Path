import type {
  AiModel,
  AiModelPurpose,
  AiProvider,
  ApiAiModel,
  ApiModelPricing,
} from "@path/shared";

const REQUEST_TIMEOUT_MS = 15_000;
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/auth/key";
const OPENROUTER_CATALOG_TTL_MS = 300_000;

let cachedOpenRouterCatalog: { models: ApiAiModel[]; fetchedAt: number } | null = null;

interface ProviderResponse {
  data?: unknown;
  models?: unknown;
  error?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function providerError(provider: AiProvider, value: unknown): string {
  const response = record(value);
  const error = record(response?.error);
  const message =
    (typeof error?.message === "string" && error.message) ||
    (typeof response?.message === "string" && response.message);

  return message
    ? `${provider} rejected the request: ${message}`
    : `${provider} rejected the request`;
}

async function requestModels(
  provider: AiProvider,
  url: string,
  headers: Record<string, string>,
): Promise<ProviderResponse> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  // Providers have different response shapes; parse transport data before provider-specific validation.
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new Error(`${provider} returned an invalid model response`);
  }

  if (!response.ok) throw new Error(providerError(provider, body));

  return record(body) ?? {};
}

function uniqueSorted<T extends AiModel>(models: T[]): T[] {
  // Model IDs are selection identities; display names may overlap or sort numerically.
  return Array.from(new Map(models.map((model) => [model.id, model])).values()).sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function anthropicModels(response: ProviderResponse): AiModel[] {
  if (!Array.isArray(response.data)) {
    throw new Error("Anthropic returned an invalid model list");
  }

  return uniqueSorted(
    response.data.flatMap((value) => {
      const model = record(value);

      return typeof model?.id === "string"
        ? [
            {
              id: model.id,
              name: typeof model.display_name === "string" ? model.display_name : model.id,
            },
          ]
        : [];
    }),
  );
}

function openAiModels(response: ProviderResponse): AiModel[] {
  if (!Array.isArray(response.data)) {
    throw new Error("OpenAI returned an invalid model list");
  }

  return uniqueSorted(
    response.data.flatMap((value) => {
      const model = record(value);

      if (typeof model?.id !== "string" || !/^(gpt-|chatgpt-|o[1-9](?:-|$))/.test(model.id)) {
        return [];
      }

      return [{ id: model.id, name: model.id }];
    }),
  );
}

function googleModels(response: ProviderResponse): AiModel[] {
  if (!Array.isArray(response.models)) {
    throw new Error("Google returned an invalid model list");
  }

  return uniqueSorted(
    response.models.flatMap((value) => {
      const model = record(value);
      const methods = model?.supportedGenerationMethods;

      if (
        typeof model?.name !== "string" ||
        !Array.isArray(methods) ||
        !methods.includes("generateContent")
      ) {
        return [];
      }

      return [
        {
          id: model.name.replace(/^models\//, ""),
          name:
            typeof model.displayName === "string"
              ? model.displayName
              : model.name.replace(/^models\//, ""),
        },
      ];
    }),
  );
}

function openRouterModels(response: ProviderResponse): ApiAiModel[] {
  if (!Array.isArray(response.data)) {
    throw new Error("OpenRouter returned an invalid model list");
  }

  return uniqueSorted(
    response.data.flatMap((value): ApiAiModel[] => {
      const model = record(value);

      if (typeof model?.id !== "string") return [];

      const architecture = record(model.architecture);
      const inputModalities = architecture?.input_modalities;
      const outputModalities = architecture?.output_modalities;

      if (
        !Array.isArray(inputModalities) ||
        !inputModalities.includes("text") ||
        !Array.isArray(outputModalities) ||
        !outputModalities.includes("text")
      ) {
        return [];
      }

      const pricing = openRouterPricing(record(model.pricing));
      const vendor = model.id.includes("/") ? model.id.split("/")[0]! : null;

      return [
        {
          id: model.id,
          name: typeof model.name === "string" ? model.name : model.id,
          provider: "openrouter",
          supportedPurposes: inputModalities.includes("image") ? ["visual", "text"] : ["text"],
          vendor,
          contextLength:
            typeof model.context_length === "number" && Number.isFinite(model.context_length)
              ? model.context_length
              : null,
          pricing,
          isFree:
            model.id.endsWith(":free") ||
            (pricing !== null &&
              pricing.promptPerMillion === 0 &&
              pricing.completionPerMillion === 0),
        },
      ];
    }),
  );
}

function openRouterPricing(pricing: Record<string, unknown> | null): ApiModelPricing | null {
  const prompt = perMillionTokens(pricing?.prompt);
  const completion = perMillionTokens(pricing?.completion);

  return prompt === null || completion === null
    ? null
    : { promptPerMillion: prompt, completionPerMillion: completion };
}

function perMillionTokens(value: unknown): number | null {
  const perToken = typeof value === "string" ? Number(value) : value;

  if (typeof perToken !== "number" || !Number.isFinite(perToken)) return null;

  // Per-token decimals carry float dust past the fourth display decimal.
  return Math.round(perToken * 1_000_000 * 10_000) / 10_000;
}

/**
 * Public catalog any menu can browse; keyed validation stays on the auth
 * endpoint because listing models never proves a key works.
 */
export async function listOpenRouterCatalog(): Promise<ApiAiModel[]> {
  if (
    cachedOpenRouterCatalog &&
    Date.now() - cachedOpenRouterCatalog.fetchedAt < OPENROUTER_CATALOG_TTL_MS
  ) {
    return cachedOpenRouterCatalog.models;
  }

  const models = openRouterModels(await requestModels("openrouter", OPENROUTER_MODELS_URL, {}));

  cachedOpenRouterCatalog = { models, fetchedAt: Date.now() };

  return models;
}

async function validateOpenRouterKey(key: string): Promise<void> {
  await requestModels("openrouter", OPENROUTER_KEY_URL, { Authorization: `Bearer ${key}` });
}

export async function listProviderModels(provider: AiProvider, key: string): Promise<ApiAiModel[]> {
  switch (provider) {
    case "anthropic":
      return directApiModels(
        provider,
        anthropicModels(
          await requestModels(provider, "https://api.anthropic.com/v1/models?limit=1000", {
            "anthropic-version": "2023-06-01",
            "x-api-key": key,
          }),
        ),
      );
    case "openai":
      return directApiModels(
        provider,
        openAiModels(
          await requestModels(provider, "https://api.openai.com/v1/models", {
            Authorization: `Bearer ${key}`,
          }),
        ),
      );
    case "google":
      return directApiModels(
        provider,
        googleModels(
          await requestModels(
            provider,
            `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
            {},
          ),
        ),
      );
    case "openrouter":
      await validateOpenRouterKey(key);

      return listOpenRouterCatalog();
  }
}

function directApiModels(provider: AiProvider, models: AiModel[]): ApiAiModel[] {
  return models.flatMap((model) => {
    const supportedPurposes = directModelPurposes(provider, model.id);

    if (supportedPurposes.length === 0) return [];

    return [
      {
        ...model,
        provider,
        supportedPurposes,
        vendor: null,
        contextLength: null,
        pricing: null,
        isFree: false,
      },
    ];
  });
}

function directModelPurposes(provider: AiProvider, modelId: string): AiModelPurpose[] {
  // Direct catalogs omit modality metadata; admit only families supported by our chat transports.
  if (provider === "anthropic") {
    if (!modelId.startsWith("claude-")) return [];

    return /^claude-(?:3|[4-9]|(?:haiku|sonnet|opus)-[4-9])/.test(modelId)
      ? ["visual", "text"]
      : ["text"];
  }

  if (provider === "openai") {
    if (
      !/^(?:gpt-[3-9]|chatgpt-)/.test(modelId) ||
      /(?:^|-)(?:audio|realtime|transcribe|tts|image|search|instruct|codex|pro)(?:-|$)/.test(
        modelId,
      )
    ) {
      return [];
    }

    return /^(?:gpt-(?:4o|4\.[15]|4-turbo|5)|chatgpt-4o)/.test(modelId)
      ? ["visual", "text"]
      : ["text"];
  }

  if (provider === "google") {
    if (
      !/^(?:gemini|gemma)-/.test(modelId) ||
      /(?:^|-)(?:embedding|image|tts|audio|live|robotics)(?:-|$)/.test(modelId)
    ) {
      return [];
    }

    return modelId.startsWith("gemini-") ? ["visual", "text"] : ["text"];
  }

  return [];
}
