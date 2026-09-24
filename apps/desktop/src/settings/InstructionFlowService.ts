import { randomUUID } from "node:crypto";
import type { AppSettingsRepository } from "@path/database";
import {
  BUILT_IN_FLOWS,
  instructionFlowIdInputSchema,
  loadInstructionFlows,
  migrateInstructionFlowsInputSchema,
  resolveInstructionFlows,
  saveInstructionFlowInputSchema,
  type InstructionFlow,
  type InstructionFlowState,
  type MigrateInstructionFlowsInput,
  type SaveInstructionFlowInput,
} from "@path/shared";

const PROMPTS_SETTINGS_KEY = "instruction-flows";

/** Owns the prompt library across windows; each mutation starts from the last committed state. */
export class InstructionFlowService {
  private current = loadInstructionFlows(null);
  private migratedLegacyIds = new Set<string>();
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: Pick<AppSettingsRepository, "get" | "set">,
    private readonly onChanged: (state: InstructionFlowState) => void = () => undefined,
  ) {}

  async initialize(): Promise<void> {
    const stored = await this.repository.get<unknown>(PROMPTS_SETTINGS_KEY);

    this.current = loadInstructionFlows(stored ? JSON.stringify(stored) : null);
    if (
      stored &&
      typeof stored === "object" &&
      "migratedLegacyIds" in stored &&
      Array.isArray(stored.migratedLegacyIds)
    ) {
      this.migratedLegacyIds = new Set(
        stored.migratedLegacyIds.filter(
          (id): id is string => typeof id === "string" && id.startsWith("custom-"),
        ),
      );
    }
  }

  get(): InstructionFlowState {
    return structuredClone(this.current);
  }

  migrate(input: MigrateInstructionFlowsInput): Promise<InstructionFlowState> {
    const migration = migrateInstructionFlowsInputSchema.parse(input);

    return this.enqueue(async () => {
      const next = this.get();
      const migratedIds = new Set(this.migratedLegacyIds);
      const existing = resolveInstructionFlows(next);

      for (const flow of migration.customFlows) {
        if (migratedIds.has(flow.id)) continue;
        migratedIds.add(flow.id);
        if (existing.some((candidate) => candidate.id === flow.id)) continue;

        // Preserve both prompts when an earlier desktop edit already owns the legacy name.
        let name = flow.name;
        let suffixIndex = 2;

        while (
          existing.some(
            (candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        ) {
          const suffix = ` (${suffixIndex++})`;

          name = `${flow.name.slice(0, 80 - suffix.length)}${suffix}`;
        }

        const imported: InstructionFlow = { ...flow, name, icon: flow.icon ?? "file-text" };

        next.customFlows.push(imported);
        existing.push(imported);
      }

      if (next.revision === 0 && existing.some((flow) => flow.id === migration.selectedId)) {
        next.selectedId = migration.selectedId;
      }

      if (
        migratedIds.size === this.migratedLegacyIds.size &&
        next.selectedId === this.current.selectedId
      ) {
        return this.get();
      }

      return this.commit(next, migratedIds);
    });
  }

  select(input: { id: string }): Promise<InstructionFlowState> {
    const { id } = instructionFlowIdInputSchema.parse(input);

    return this.enqueue(async () => {
      const next = this.get();

      if (!resolveInstructionFlows(next).some((flow) => flow.id === id)) {
        throw new Error("This prompt is no longer available.");
      }

      if (next.selectedId === id) return this.get();

      next.selectedId = id;

      return this.commit(next);
    });
  }

  save(input: SaveInstructionFlowInput): Promise<InstructionFlowState> {
    const draft = saveInstructionFlowInputSchema.parse(input);

    return this.enqueue(async () => {
      const next = this.get();
      const flows = resolveInstructionFlows(next);
      const existing = draft.id ? flows.find((flow) => flow.id === draft.id) : null;

      if (draft.id && !existing) throw new Error("This prompt is no longer available.");
      if (
        existing &&
        (existing.name !== draft.expected?.name ||
          existing.instructions !== draft.expected?.instructions ||
          existing.icon !== draft.expected?.icon)
      ) {
        throw new Error(
          "This prompt changed in another window. Close and reopen it before saving.",
        );
      }

      if (
        flows.some(
          (flow) =>
            flow.id !== draft.id &&
            flow.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase(),
        )
      ) {
        throw new Error("A prompt with this name already exists.");
      }

      const builtIn = BUILT_IN_FLOWS.find((flow) => flow.id === draft.id);
      const id = draft.id ?? `custom-${randomUUID()}`;

      if (builtIn) {
        if (draft.name !== builtIn.name) throw new Error("Default prompts cannot be renamed.");

        next.builtInOverrides = next.builtInOverrides.filter((flow) => flow.id !== id);
        next.builtInOverrides.push({ id, instructions: draft.instructions, icon: draft.icon });
      } else {
        const flow: InstructionFlow = {
          id,
          name: draft.name,
          instructions: draft.instructions,
          icon: draft.icon,
        };

        const index = next.customFlows.findIndex((candidate) => candidate.id === id);

        if (index === -1) next.customFlows.push(flow);
        else next.customFlows[index] = flow;
      }

      if (draft.select) next.selectedId = id;

      return this.commit(next);
    });
  }

  remove(input: { id: string }): Promise<InstructionFlowState> {
    const { id } = instructionFlowIdInputSchema.parse(input);

    return this.enqueue(async () => {
      if (BUILT_IN_FLOWS.some((flow) => flow.id === id)) {
        throw new Error("Default prompts cannot be deleted.");
      }

      const next = this.get();

      if (!next.customFlows.some((flow) => flow.id === id)) {
        throw new Error("This prompt is no longer available.");
      }

      next.customFlows = next.customFlows.filter((flow) => flow.id !== id);
      if (next.selectedId === id) next.selectedId = "help-guide";

      return this.commit(next);
    });
  }

  private enqueue(mutate: () => Promise<InstructionFlowState>): Promise<InstructionFlowState> {
    const result = this.mutation.then(mutate);

    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private async commit(
    next: InstructionFlowState,
    migratedIds = this.migratedLegacyIds,
  ): Promise<InstructionFlowState> {
    next.revision = this.current.revision + 1;
    await this.repository.set(PROMPTS_SETTINGS_KEY, {
      ...next,
      migratedLegacyIds: [...migratedIds],
    });
    this.current = next;
    this.migratedLegacyIds = migratedIds;
    this.onChanged(this.get());

    return this.get();
  }
}
