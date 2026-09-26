import {
  cliToolNames,
  type AiModelPurpose,
  type AiModelSelection,
  type AiProvider,
  type AiProviderKeyStatus,
  type AvailableAiModels,
  type CliState,
} from "@path/shared";

/** Why a model purpose can or cannot run, as shown before the first generation. */
export type ModelReadiness =
  | { status: "checking" }
  | { status: "ready"; modelName: string }
  | { status: "not-chosen" }
  | { status: "ollama-unavailable"; modelName: string }
  | { status: "model-missing"; modelName: string; modelId: string }
  | { status: "key-missing"; modelName: string; provider: AiProvider }
  | { status: "cli-unavailable"; modelName: string };

interface ModelReadinessInput {
  purpose: AiModelPurpose;
  selection: AiModelSelection | null;
  models: AvailableAiModels;
  keyStatus: AiProviderKeyStatus;
  isLoading: boolean;
  cli: CliState | null;
}

export function getModelReadiness({
  purpose,
  selection,
  models,
  keyStatus,
  isLoading,
  cli,
}: ModelReadinessInput): ModelReadiness {
  if (isLoading) return { status: "checking" };

  // Text generation may run through a connected CLI tool instead of the selected model.
  if (purpose === "text" && cli?.mode === "cli") return getCliReadiness(cli);

  if (!selection) return { status: "not-chosen" };

  const { modelName } = selection;

  if (selection.source === "api") {
    return keyStatus[selection.provider]
      ? { status: "ready", modelName }
      : { status: "key-missing", modelName, provider: selection.provider };
  }

  if (models.ollama.status === "unavailable") return { status: "ollama-unavailable", modelName };

  if (!models.local.some((model) => model.id === selection.modelId)) {
    return { status: "model-missing", modelName, modelId: selection.modelId };
  }

  return { status: "ready", modelName };
}

function getCliReadiness(cli: CliState): ModelReadiness {
  if (!cli.selection) return { status: "not-chosen" };

  const tool = cli.tools.find((candidate) => candidate.id === cli.selection?.tool);
  const modelName = cliToolNames[cli.selection.tool];

  return tool?.status === "ready"
    ? { status: "ready", modelName }
    : { status: "cli-unavailable", modelName };
}
