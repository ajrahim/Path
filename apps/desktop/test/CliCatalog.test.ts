import { expect, it } from "vitest";
import { parseCliModels, parseCopilotModels } from "../src/ai/CliCatalog";

it("uses each CLI's reported models and efforts without adding a fallback catalog", () => {
  expect(
    parseCliModels("codex", {
      data: [
        {
          model: "model-a",
          displayName: "A",
          supportedReasoningEfforts: [{ reasoningEffort: "high" }, {}],
        },
      ],
    }),
  ).toEqual([{ id: "model-a", name: "A", description: "", efforts: ["high"] }]);
  expect(
    parseCliModels("claude", { models: [{ value: "haiku", displayName: "Haiku" }] })[0]?.efforts,
  ).toEqual([]);
  expect(
    parseCliModels("claude", {
      models: [{ value: "opus", supportedEffortLevels: ["low", "max"] }],
    })[0]?.efforts,
  ).toEqual(["low", "max"]);
  expect(
    parseCliModels(
      "muse",
      { models: [{ modelId: "muse", displayLabel: "Muse", description: "Provider disclosure" }] },
      ["low", "high"],
    )[0],
  ).toEqual({
    id: "muse",
    name: "Muse",
    description: "Provider disclosure",
    efforts: ["low", "high"],
  });
  expect(parseCliModels("codex", {})).toEqual([]);
});

it("keeps Copilot effort choices attached to the active model", () => {
  const result = parseCopilotModels({
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "a",
        options: [
          { value: "a", name: "A" },
          { group: "Other", options: [{ value: "b", name: "B" }] },
        ],
      },
      { id: "reasoning_effort", options: [{ value: "high", name: "High" }] },
    ],
  });

  expect(result.map((model) => [model.id, model.efforts])).toEqual([
    ["a", ["high"]],
    ["b", []],
  ]);
  expect(
    parseCopilotModels({
      models: {
        availableModels: [{ modelId: "legacy", name: "Legacy" }],
        currentModelId: "legacy",
      },
    })[0]?.id,
  ).toBe("legacy");
});
