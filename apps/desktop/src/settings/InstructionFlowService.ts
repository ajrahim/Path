import { randomUUID } from "node:crypto";
import {
  BUILT_IN_FLOWS,
  instructionFlowIdInputSchema,
  parseInstructionFlowState,
  resolveInstructionFlows,
  saveInstructionFlowInputSchema,
  type InstructionFlow,
  type InstructionFlowState,
  type SaveInstructionFlowInput,
} from "@path/shared";
import type { RemoteRepositories } from "../storage/DatabaseClient";

const PROMPTS_SETTINGS_KEY = "instruction-flows";

/** Owns the prompt library across windows; each mutation starts from the last committed state. */
export class InstructionFlowService {
  private current = parseInstructionFlowState(null);
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: Pick<RemoteRepositories["appSettings"], "get" | "set">,
    private readonly onChanged: (state: InstructionFlowState) => void = () => undefined,
  ) {}

  async initialize(): Promise<void> {
    this.current = parseInstructionFlowState(await this.repository.get(PROMPTS_SETTINGS_KEY));
  }

  get(): InstructionFlowState {
    return structuredClone(this.current);
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

  private async commit(next: InstructionFlowState): Promise<InstructionFlowState> {
    next.revision = this.current.revision + 1;
    await this.repository.set(PROMPTS_SETTINGS_KEY, next);
    this.current = next;
    this.onChanged(this.get());

    return this.get();
  }
}
