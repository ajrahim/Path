import { vi } from "vitest";
import {
  BUILT_IN_FLOWS,
  parseInstructionFlowState,
  type DesktopApi,
  type InstructionFlowState,
} from "@path/shared";

/** In-memory bridge for renderer tests; service invariants are covered by desktop tests. */
export function createInstructionFlowFixture(initial = parseInstructionFlowState(null)) {
  let state = structuredClone(initial);
  const listeners = new Set<(snapshot: InstructionFlowState) => void>();

  function publish(next: InstructionFlowState) {
    state = structuredClone(next);
    listeners.forEach((listener) => listener(structuredClone(state)));

    return structuredClone(state);
  }

  const api: DesktopApi["instructionFlows"] = {
    get: vi.fn(async () => structuredClone(state)),
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
