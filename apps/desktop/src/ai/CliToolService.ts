import { mkdir, realpath, stat } from "node:fs/promises";
import type { RemoteRepositories } from "../storage/DatabaseClient";
import {
  cliPreferencesSchema,
  cliToolIds,
  type CliModel,
  type CliPreferences,
  type CliSelection,
  type CliState,
  type CliToolId,
  type CliToolStatus,
} from "@path/shared";
import { findCliExecutable } from "./CliProcess";
import { discoverCliModels } from "./CliCatalog";
import { generateWithCli } from "./CliGeneration";

const SETTINGS_KEY = "cli-tools";

export class CliToolService {
  private preferences: CliPreferences = { mode: "model", connected: [], selection: null };
  private statuses = new Map<CliToolId, CliToolStatus>();
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private allowedFolders = new Set<string>();
  constructor(
    private repository: Pick<RemoteRepositories["appSettings"], "get" | "set">,
    private workRoot: string,
    private onChanged: (state: CliState) => void = () => {},
  ) {}
  async initialize() {
    const parsed = cliPreferencesSchema.safeParse(await this.repository.get(SETTINGS_KEY));

    if (parsed.success) this.preferences = parsed.data;
    await mkdir(this.workRoot, { recursive: true });
  }
  get(): CliState {
    return structuredClone({
      ...this.preferences,
      revision: this.revision,
      tools: cliToolIds.map(
        (id) =>
          this.statuses.get(id) ?? {
            id,
            installed: false,
            connected: this.preferences.connected.includes(id),
            status: "disconnected",
            models: [],
          },
      ),
    });
  }
  private publish() {
    this.revision++;
    const snapshot = this.get();

    this.onChanged(snapshot);

    return snapshot;
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);

    this.queue = next.catch(() => {});

    return next;
  }
  async refresh(tool?: CliToolId, model?: string): Promise<CliState> {
    return this.serialize(async () => {
      await Promise.all(
        (tool ? [tool] : cliToolIds).map(async (id) => {
          const executable = await findCliExecutable(id),
            connected = this.preferences.connected.includes(id);

          let status: CliToolStatus = {
            id,
            installed: Boolean(executable),
            connected,
            status: executable ? "disconnected" : "not-installed",
            models: [],
          };

          if (executable && connected) {
            try {
              const models = await discoverCliModels(id, executable, this.workRoot, model);

              status = { ...status, status: models.length ? "ready" : "unavailable", models };
            } catch (error) {
              status.status =
                error instanceof Error && /auth|sign.in/i.test(error.message)
                  ? "sign-in-required"
                  : "unavailable";
            }
          }

          this.statuses.set(id, status);
        }),
      );

      return this.publish();
    });
  }
  async connect(tool: CliToolId, connected: boolean): Promise<CliState> {
    return this.serialize(async () => {
      if (connected) {
        const executable = await findCliExecutable(tool);

        if (!executable) throw new Error("CLI is not installed");
        let models: CliModel[];

        try {
          models = await discoverCliModels(tool, executable, this.workRoot);
        } catch (error) {
          this.statuses.set(tool, {
            id: tool,
            installed: true,
            connected: this.preferences.connected.includes(tool),
            status:
              error instanceof Error && /auth|sign.in/i.test(error.message)
                ? "sign-in-required"
                : "unavailable",
            models: [],
          });
          this.publish();

          throw error;
        }

        if (!models.length) throw new Error("CLI returned no available models");
        const next = {
          ...this.preferences,
          connected: [...new Set([...this.preferences.connected, tool])],
        };

        await this.repository.set(SETTINGS_KEY, next);
        this.preferences = next;
        this.statuses.set(tool, {
          id: tool,
          installed: true,
          connected: true,
          status: "ready",
          models,
        });
      } else {
        const next = {
          ...this.preferences,
          connected: this.preferences.connected.filter((id) => id !== tool),
          mode:
            this.preferences.selection?.tool === tool ? ("model" as const) : this.preferences.mode,
        };

        await this.repository.set(SETTINGS_KEY, next);
        this.preferences = next;
        this.statuses.set(tool, {
          id: tool,
          installed: Boolean(await findCliExecutable(tool)),
          connected: false,
          status: "disconnected",
          models: [],
        });
      }

      return this.publish();
    });
  }
  async select(selection: CliSelection): Promise<CliState> {
    return this.serialize(async () => {
      if (!this.preferences.connected.includes(selection.tool)) {
        throw new Error("Connect this CLI in Settings first");
      }

      const executable = await findCliExecutable(selection.tool);

      if (!executable) throw new Error("CLI is no longer installed");
      const models = await discoverCliModels(
        selection.tool,
        executable,
        this.workRoot,
        selection.model,
      );

      const model = models.find((model) => model.id === selection.model);

      if (!model || (selection.effort && !model.efforts.includes(selection.effort))) {
        throw new Error("This CLI model or effort is no longer available");
      }

      const next = { ...this.preferences, mode: "cli" as const, selection };

      await this.repository.set(SETTINGS_KEY, next);
      this.preferences = next;
      this.statuses.set(selection.tool, {
        id: selection.tool,
        installed: true,
        connected: true,
        status: "ready",
        models,
      });

      return this.publish();
    });
  }
  async setMode(mode: "model" | "cli"): Promise<CliState> {
    return this.serialize(async () => {
      if (
        mode === "cli" &&
        (!this.preferences.selection ||
          !this.preferences.connected.includes(this.preferences.selection.tool))
      ) {
        throw new Error("Choose a connected CLI model first");
      }

      const next = { ...this.preferences, mode };

      await this.repository.set(SETTINGS_KEY, next);
      this.preferences = next;

      return this.publish();
    });
  }
  async allowFolder(folder: string): Promise<string> {
    const resolved = await realpath(folder);

    if (!(await stat(resolved)).isDirectory()) throw new Error("Choose a folder");
    this.allowedFolders.add(resolved);

    return resolved;
  }
  async generate(prompt: string, folder?: string): Promise<string> {
    const selection = this.preferences.selection;

    if (
      this.preferences.mode !== "cli" ||
      !selection ||
      !this.preferences.connected.includes(selection.tool)
    ) {
      throw new Error("Connect and select a CLI first");
    }

    if (folder && !this.allowedFolders.has(folder)) {
      throw new Error("Choose the context folder again");
    }

    const executable = await findCliExecutable(selection.tool);

    if (!executable) throw new Error("CLI is no longer installed");
    const text = await generateWithCli(executable, selection, prompt, this.workRoot, folder);

    if (!text.trim()) throw new Error("CLI returned no document");

    return text;
  }
}
