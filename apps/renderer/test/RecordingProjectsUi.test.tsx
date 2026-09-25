// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  ProjectChangeInput,
  RecordingProject,
  RecordingSummary,
} from "@path/shared";
import messages from "@path/shared/messages/en.json";
import { HistorySidebar } from "../src/components/HistorySidebar";
import { createRendererStore } from "../src/state/RendererStore";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };

  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

async function setup() {
  let projects: RecordingProject[] = [];
  const item: RecordingSummary = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Workspace walkthrough",
    status: "ready",
    captureMode: "display",
    durationMs: 12000,
    thumbnailPath: null,
    startedAt: "2026-09-20T10:00:00Z",
    completedAt: null,
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-20T10:00:00Z",
    transcriptStatus: "ready",
  };

  const change = vi.fn(async (input: ProjectChangeInput) => {
    if (input.action === "create") {
      projects = [
        ...projects,
        { id: "22222222-2222-4222-8222-222222222222", name: input.name, recordingIds: [] },
      ];
    }

    if (input.action === "move") {
      projects = projects.map((project) => ({
        ...project,
        recordingIds: project.id === input.projectId ? [input.recordingId] : [],
      }));
    }

    if (input.action === "remove") projects = projects.filter((project) => project.id !== input.id);
    if (input.action === "rename") {
      projects = projects.map((project) =>
        project.id === input.id ? { ...project, name: input.name } : project,
      );
    }

    return structuredClone(projects);
  });

  const desktop = {
    projects: { list: async () => structuredClone(projects), change },
    recordings: { list: async () => [item], thumbnailUrl: async () => null },
    app: { getInfo: async () => ({ version: "0.3.0" }) },
  } as unknown as DesktopApi;

  window.desktop = desktop;
  const store = createRendererStore({ getDesktopApi: () => desktop });
  const onSelect = vi.fn();
  const view = render(
    <Provider store={store}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <HistorySidebar
          selectedId={item.id}
          onSelect={onSelect}
          onDeleted={vi.fn()}
          onNewRecording={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </NextIntlClientProvider>
    </Provider>,
  );

  await act(async () => {});

  return { view, change, item, onSelect };
}

describe("Recording Projects", () => {
  it("creates a folder, supports dropping recordings, searching collapsed folders, and removing the folder safely", async () => {
    const { view, change, item, onSelect } = await setup();

    fireEvent.click(view.getByRole("button", { name: "Create Project" }));
    fireEvent.change(view.getByLabelText("Project name"), { target: { value: "Onboarding" } });
    await act(async () => {
      fireEvent.click(
        within(view.getByRole("dialog")).getByRole("button", { name: "Create Project" }),
      );
    });
    const folder = view.getByRole("region", { name: "Onboarding" });
    const row = view.container.querySelector(`[data-recording-id="${item.id}"]`)!;
    const values: Record<string, string> = {};
    const dataTransfer = {
      setData: (key: string, value: string) => {
        values[key] = value;
      },
      getData: (key: string) => values[key],
      effectAllowed: "",
      dropEffect: "",
    };

    fireEvent.dragStart(row, { dataTransfer });
    expect(fireEvent.dragEnter(folder, { dataTransfer })).toBe(false);
    fireEvent.dragOver(folder, { dataTransfer });
    await act(async () => {
      fireEvent.drop(folder, { dataTransfer });
    });
    expect(change).toHaveBeenLastCalledWith({
      action: "move",
      recordingId: item.id,
      projectId: "22222222-2222-4222-8222-222222222222",
    });
    fireEvent.click(within(folder).getByRole("button", { name: /Workspace walkthrough/ }));
    expect(onSelect).toHaveBeenCalledWith(item.id);
    const all = view.getByRole("region", { name: "All" });

    expect(within(all).getByRole("button", { name: /Workspace walkthrough/ })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Projects" }));
    expect(within(folder).queryByRole("button", { name: /Workspace walkthrough/ })).toBeNull();
    expect(within(all).getByRole("button", { name: /Workspace walkthrough/ })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Projects" }));
    expect(view.getByRole("button", { name: "Create Project" })).toBeTruthy();
    expect(view.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "Projects",
      "Onboarding",
      "All",
    ]);
    fireEvent.click(within(folder).getByRole("button", { name: "Onboarding" }));
    expect(within(folder).queryByRole("button", { name: /Workspace walkthrough/ })).toBeNull();
    fireEvent.change(view.getByRole("textbox", { name: "Search recordings" }), {
      target: { value: "Workspace" },
    });
    expect(within(folder).getByRole("button", { name: /Workspace walkthrough/ })).toBeTruthy();
    fireEvent.change(view.getByRole("textbox", { name: "Search recordings" }), {
      target: { value: "" },
    });
    fireEvent.contextMenu(within(folder).getByRole("button", { name: "Onboarding" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Remove Project" }));
    expect(view.getByText(/No recordings will be deleted/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Remove Project" }));
    });
    expect(view.queryByRole("region", { name: "Onboarding" })).toBeNull();
    expect(
      within(view.getByRole("region", { name: "All" })).getByRole("button", {
        name: /Workspace walkthrough/,
      }),
    ).toBeTruthy();
  });

  it("keeps grouping unchanged after a failed move and provides a keyboard-accessible move dialog", async () => {
    const { view, change } = await setup();

    fireEvent.click(view.getByRole("button", { name: "Create Project" }));
    fireEvent.change(view.getByLabelText("Project name"), { target: { value: "Examples" } });
    await act(async () => {
      fireEvent.click(
        within(view.getByRole("dialog")).getByRole("button", { name: "Create Project" }),
      );
    });
    fireEvent.contextMenu(view.getByRole("button", { name: /Workspace walkthrough/ }));
    fireEvent.click(view.getByRole("menuitem", { name: "Move to Project" }));
    fireEvent.change(view.getByLabelText("Move to"), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    change.mockRejectedValueOnce(new Error("Disk unavailable"));
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Move" }));
    });
    expect(view.getByRole("alert").textContent).toContain("Could not update");
    expect(view.container.querySelector(".history-all [data-recording-id]")).toBeTruthy();
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Move" }));
    });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.container.querySelector(".history-project [data-recording-id]")).toBeTruthy();
  });
});
