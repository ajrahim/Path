import { vi } from "vitest";
import {
  BUILT_IN_FLOWS,
  loadInstructionFlows,
  type DesktopApi,
  type InstructionFlowState,
} from "@path/shared";

/** In-memory bridge for renderer tests; service invariants are covered by desktop tests. */
export function createInstructionFlowFixture(initial = loadInstructionFlows(null)) {
  let state = structuredClone(initial);
  const listeners = new Set<(snapshot: InstructionFlowState) => void>();

  function publish(next: InstructionFlowState) {
    state = structuredClone(next);
    listeners.forEach((listener) => listener(structuredClone(state)));

    return structuredClone(state);
  }

  const api: DesktopApi["instructionFlows"] = {
    get: vi.fn(async () => structuredClone(state)),
    migrate: vi.fn(async (legacy) => {
      const existing = new Set(state.customFlows.map(({ id }) => id));
      const incoming = loadInstructionFlows(JSON.stringify(legacy)).customFlows.filter(
        ({ id }) => !existing.has(id),
      );

      if (!incoming.length && state.revision) return structuredClone(state);

      return publish({
        ...state,
        customFlows: [...state.customFlows, ...incoming],
        selectedId: state.revision ? state.selectedId : legacy.selectedId,
        revision: state.revision + 1,
      });
    }),
    select: vi.fn(async ({ id }) =>
      publish({ ...state, selectedId: id, revision: state.revision + 1 }),
    ),
    save: vi.fn(async ({ id, name, instructions, icon, select }) => {
      const savedId = id ?? `custom-${crypto.randomUUID()}`;
      const builtin = BUILT_IN_FLOWS.some((flow) => flow.id === savedId);

      return publish({
        ...state,
        revision: state.revision + 1,
        selectedId: select ? savedId : state.selectedId,
        builtInOverrides: builtin
          ? [
              ...state.builtInOverrides.filter((flow) => flow.id !== savedId),
              { id: savedId, instructions, icon },
            ]
          : state.builtInOverrides,
        customFlows: builtin
          ? state.customFlows
          : [
              ...state.customFlows.filter((flow) => flow.id !== savedId),
              { id: savedId, name, instructions, icon },
            ],
      });
    }),
    remove: vi.fn(async ({ id }) =>
      publish({
        ...state,
        revision: state.revision + 1,
        selectedId: state.selectedId === id ? "help-guide" : state.selectedId,
        customFlows: state.customFlows.filter((flow) => flow.id !== id),
      }),
    ),
    onChanged: vi.fn((listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    }),
  };

  return { api, snapshot: () => structuredClone(state), publish };
}
