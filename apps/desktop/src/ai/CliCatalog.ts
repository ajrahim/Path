import type { CliModel, CliToolId } from "@path/shared";
import { array, CliRpc, object, runCli, strings } from "./CliProcess";

export async function openCliRpc(
  tool: CliToolId,
  executable: string,
  cwd: string,
): Promise<CliRpc> {
  const args =
    tool === "codex"
      ? ["app-server", "--stdio"]
      : tool === "muse"
        ? ["serve", "--no-session-log", "--disable-write", "--disable-shell"]
        : ["--acp", "--disable-builtin-mcps", "--available-tools=view,glob,grep"];

  const rpc = new CliRpc(executable, args, cwd);

  try {
    await rpc.request(
      "initialize",
      tool === "copilot"
        ? {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "path", version: "0.3.0" },
          }
        : { clientInfo: { name: "path", version: "0.3.0" } },
    );
    rpc.send({ jsonrpc: "2.0", method: "initialized" });

    return rpc;
  } catch (error) {
    rpc.close();

    throw error;
  }
}

export function parseCliModels(
  tool: CliToolId,
  response: unknown,
  efforts: string[] = [],
): CliModel[] {
  const result = object(response);
  const rows = tool === "codex" ? array(result.data) : array(result.models);

  return rows
    .map((value) => {
      const row = object(value);
      const id = String(row.model ?? row.modelId ?? row.value ?? "");

      return {
        id,
        name: String(row.displayName ?? row.displayLabel ?? id),
        description: String(row.description ?? ""),
        efforts:
          tool === "codex"
            ? array(row.supportedReasoningEfforts)
                .map((v) => String(object(v).reasoningEffort ?? ""))
                .filter(Boolean)
            : tool === "claude"
              ? strings(row.supportedEffortLevels)
              : efforts,
      };
    })
    .filter((model) => model.id.length > 0);
}

function configOptions(value: unknown): Record<string, unknown>[] {
  return array(object(value).configOptions).map(object);
}

function optionValues(option: Record<string, unknown>): Record<string, unknown>[] {
  return array(option.options).flatMap((value) => {
    const row = object(value);

    return row.options ? array(row.options).map(object) : [row];
  });
}

export function parseCopilotModels(value: unknown, selected?: string): CliModel[] {
  const result = object(value),
    options = configOptions(result);

  const modelOption = options.find(
    (option) => option.category === "model" || option.id === "model",
  );

  const effortOption = options.find((option) =>
    /effort|reasoning|thought/i.test(String(option.id)),
  );

  const efforts = effortOption
    ? optionValues(effortOption).map((option) => String(option.value ?? ""))
    : [];

  const models = object(result.models);
  const active = selected ?? String(modelOption?.currentValue ?? models.currentModelId ?? "");
  const rows = modelOption ? optionValues(modelOption) : array(models.availableModels).map(object);

  return rows
    .map((row) => ({
      id: String(row.value ?? row.modelId ?? ""),
      name: String(row.name ?? row.modelId ?? row.value ?? ""),
      description: String(row.description ?? ""),
      efforts: String(row.value ?? row.modelId ?? "") === active ? efforts : [],
    }))
    .filter((model) => model.id.length > 0);
}

export async function selectCopilotModel(
  rpc: CliRpc,
  session: Record<string, unknown>,
  model: string,
): Promise<Record<string, unknown>> {
  const option = configOptions(session).find(
    (value) => value.category === "model" || value.id === "model",
  );

  const response = object(
    await rpc.request(
      option ? "session/set_config_option" : "session/set_model",
      option
        ? { sessionId: session.sessionId, configId: option.id, value: model }
        : { sessionId: session.sessionId, modelId: model },
    ),
  );

  return { ...session, ...response };
}

export async function setCopilotEffort(
  rpc: CliRpc,
  session: Record<string, unknown>,
  effort: string,
): Promise<void> {
  const option = configOptions(session).find((value) =>
    /effort|reasoning|thought/i.test(String(value.id)),
  );

  if (!option || !optionValues(option).some((value) => value.value === effort)) {
    throw new Error("Reasoning effort is not available for this model");
  }

  await rpc.request("session/set_config_option", {
    sessionId: session.sessionId,
    configId: option.id,
    value: effort,
  });
}

export async function discoverCliModels(
  tool: CliToolId,
  executable: string,
  cwd: string,
  model?: string,
): Promise<CliModel[]> {
  if (tool === "claude") {
    const auth = object(JSON.parse(await runCli(executable, ["auth", "status"], cwd)));

    if (auth.loggedIn !== true) throw new Error("CLI sign-in required");
    const rpc = new CliRpc(
      executable,
      [
        "--print",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--tools",
        "",
        "--strict-mcp-config",
      ],
      cwd,
    );

    try {
      return parseCliModels(tool, await rpc.initializeClaude());
    } finally {
      rpc.close();
    }
  }

  if (tool === "codex") await runCli(executable, ["login", "status"], cwd);
  const rpc = await openCliRpc(tool, executable, cwd);

  try {
    if (tool === "copilot") {
      let session = object(await rpc.request("session/new", { cwd, mcpServers: [] }));

      if (model) session = await selectCopilotModel(rpc, session, model);

      return parseCopilotModels(session, model);
    }

    const rows: CliModel[] = [];
    let cursor: unknown;

    do {
      const response = object(
        await rpc.request("model/list", tool === "codex" ? { includeHidden: false, cursor } : {}),
      );

      let efforts: string[] = [];

      if (tool === "muse") {
        const help = await runCli(executable, ["exec", "--help"], cwd);
        const reported = /Meta reasoning effort:\s*([a-z|]+)/.exec(help)?.[1];

        efforts = reported?.split("|") ?? [];
      }

      rows.push(...parseCliModels(tool, response, efforts));
      cursor = response.nextCursor;
    } while (cursor && rows.length < 200);

    return rows;
  } finally {
    rpc.close();
  }
}
