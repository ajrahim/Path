import { z } from "zod";

export const cliToolIds = ["codex", "claude", "copilot", "muse"] as const;
const cliToolIdSchema = z.enum(cliToolIds);

export type CliToolId = z.infer<typeof cliToolIdSchema>;
export const cliToolNames: Record<CliToolId, string> = {
  codex: "Codex CLI",
  claude: "Claude Code",
  copilot: "GitHub Copilot",
  muse: "Facebook Muse",
};
export interface CliModel {
  id: string;
  name: string;
  description: string;
  efforts: string[];
}
export interface CliToolStatus {
  id: CliToolId;
  installed: boolean;
  connected: boolean;
  status: "not-installed" | "disconnected" | "ready" | "sign-in-required" | "unavailable";
  models: CliModel[];
}
export const cliSelectionSchema = z.strictObject({
  tool: cliToolIdSchema,
  model: z.string().min(1).max(200),
  effort: z.string().max(30).nullable(),
});
export type CliSelection = z.infer<typeof cliSelectionSchema>;
export const cliPreferencesSchema = z.strictObject({
  mode: z.enum(["model", "cli"]),
  connected: z.array(cliToolIdSchema).max(4),
  selection: cliSelectionSchema.nullable(),
});
export type CliPreferences = z.infer<typeof cliPreferencesSchema>;
export interface CliState extends CliPreferences {
  revision: number;
  tools: CliToolStatus[];
}
export const cliConnectSchema = z.strictObject({ tool: cliToolIdSchema, connected: z.boolean() });
export const cliModeSchema = z.strictObject({ mode: z.enum(["model", "cli"]) });
export const cliModelsInputSchema = z.strictObject({
  tool: cliToolIdSchema,
  model: z.string().max(200).optional(),
});
