import type { AiModel, AiProvider } from "@path/shared";

const REQUEST_TIMEOUT_MS = 15_000;

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

function uniqueSorted(models: AiModel[]): AiModel[] {
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

export async function listProviderModels(provider: AiProvider, key: string): Promise<AiModel[]> {
  switch (provider) {
    case "anthropic":
      return anthropicModels(
        await requestModels(provider, "https://api.anthropic.com/v1/models?limit=1000", {
          "anthropic-version": "2023-06-01",
          "x-api-key": key,
        }),
      );
    case "openai":
      return openAiModels(
        await requestModels(provider, "https://api.openai.com/v1/models", {
          Authorization: `Bearer ${key}`,
        }),
      );
    case "google":
      return googleModels(
        await requestModels(
          provider,
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
          {},
        ),
      );
  }
}
