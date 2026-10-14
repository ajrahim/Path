// @vitest-environment jsdom

import { cleanup, createEvent, fireEvent, render, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@path/shared/messages/en.json";
import { GuideDocumentStructure } from "../src/components/GuideDocumentStructure";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(cleanup);

function structure(
  disabled = false,
  mode: "combine" | "split" = "split",
  workflows = [
    { id: "login", title: "Login" },
    { id: "registration", title: "Registration" },
    { id: "password", title: "Forgot Password" },
  ],
) {
  const onSelect = vi.fn();
  const onAdd = vi.fn(async () => true);
  const onRemove = vi.fn();
  const onRename = vi.fn(async () => true);
  const onReorder = vi.fn(async () => true);
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GuideDocumentStructure
        mode={mode}
        disabled={disabled}
        activeDocumentId="login"
        workflows={workflows}
        onSelect={onSelect}
        onAdd={onAdd}
        onRemove={onRemove}
        onRename={onRename}
        onReorder={onReorder}
      />
    </NextIntlClientProvider>,
  );

  return { ...view, onSelect, onAdd, onRemove, onRename, onReorder };
}

describe("GuideDocumentStructure", () => {
  it.each([{ key: "ContextMenu" }, { key: "F10", shiftKey: true }])(
    "opens tab actions with $key and returns focus on Escape",
    (shortcut) => {
      const view = structure();
      const tab = view.getByRole("tab", { name: "Login" });

      tab.focus();
      fireEvent.keyDown(tab, shortcut);
      const rename = view.getByRole("menuitem", { name: "Rename" });

      expect(document.activeElement).toBe(rename);
      fireEvent.keyDown(rename, { key: "ArrowDown" });
      expect(document.activeElement).toBe(view.getByRole("menuitem", { name: "Delete" }));
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(view.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(tab);
    },
  );

  it("renames through the prefilled modal without rejecting its own title", async () => {
    const view = structure();
    const tab = view.getByRole("tab", { name: "Login" });

    fireEvent.contextMenu(tab);
    fireEvent.click(view.getByRole("menuitem", { name: "Rename" }));
    const dialog = view.getByRole("dialog", { name: "Rename split" });
    const input = within(dialog).getByRole("textbox", {
      name: "Workflow name",
    }) as HTMLInputElement;

    const confirm = within(dialog).getByRole("button", { name: "Rename" }) as HTMLButtonElement;

    expect(input.value).toBe("Login");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
    expect(confirm.disabled).toBe(false);
    fireEvent.change(input, { target: { value: " registration " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " " } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "A".repeat(121) } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " Sign in " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(view.onRename).toHaveBeenCalledWith("login", "Sign in");
    expect(document.activeElement).toBe(tab);
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it("retains a rename on failure and cancels without persisting it", async () => {
    const view = structure();

    view.onRename.mockResolvedValueOnce(false);
    fireEvent.contextMenu(view.getByRole("tab", { name: "Login" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Rename" }));
    const dialog = view.getByRole("dialog", { name: "Rename split" });
    const input = within(dialog).getByRole("textbox", {
      name: "Workflow name",
    }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Sign in" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        messages.guide.structureSaveFailed,
      ),
    );
    expect(input.value).toBe("Sign in");
    expect(view.getByRole("tab", { name: "Login" })).toBeTruthy();
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(view.onRename).toHaveBeenCalledTimes(2);
    fireEvent.contextMenu(view.getByRole("tab", { name: "Login" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Rename" }));
    fireEvent.keyDown(view.getByRole("textbox", { name: "Workflow name" }), { key: "Escape" });
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.onRename).toHaveBeenCalledTimes(2);
  });

  it("dismisses tab actions on an outside pointer without changing the plan", () => {
    const view = structure();

    fireEvent.contextMenu(view.getByRole("tab", { name: "Login" }));
    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("menu")).toBeNull();
    expect(view.onRename).not.toHaveBeenCalled();
    expect(view.onRemove).not.toHaveBeenCalled();
  });

  it("offers Rename and Delete on right-click without an inline close button", () => {
    const view = structure();

    expect(view.queryByRole("button", { name: "Remove Login split" })).toBeNull();
    fireEvent.contextMenu(view.getByRole("tab", { name: "Login" }), { clientX: 180, clientY: 100 });
    const menu = view.getByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(view.onRemove).toHaveBeenCalledWith("login");
  });

  it("opens the workflow name in a modal and returns focus to Add split on cancellation", async () => {
    const view = structure();
    const trigger = view.getByRole("button", { name: "Add split" });

    trigger.focus();
    fireEvent.click(trigger);
    const dialog = view.getByRole("dialog", { name: "Add split" });
    const input = within(dialog).getByRole("textbox", { name: "Workflow name" });

    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe(input);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel workflow" }));
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(view.onAdd).not.toHaveBeenCalled();
  });

  it("hides split tabs and count in Combine mode", () => {
    const view = structure(false, "combine");

    expect(view.queryByRole("tablist")).toBeNull();
    expect(view.queryByText("3 splits")).toBeNull();
    expect(view.queryByRole("button", { name: "Add split" })).toBeNull();
  });

  it("exposes selected named tabs and Add without a split count", () => {
    const view = structure();

    expect(view.getByRole("tab", { name: "Login" }).getAttribute("aria-selected")).toBe("true");
    expect(view.queryByText("3 splits")).toBeNull();
    expect(view.getByRole("button", { name: "Add split" }).textContent).toBe("");
    fireEvent.click(view.getByRole("tab", { name: "Forgot Password" }));
    expect(view.onSelect).toHaveBeenCalledWith("password");
  });

  it("supports manual keyboard tab navigation", () => {
    const view = structure();
    const login = view.getByRole("tab", { name: "Login" });

    fireEvent.keyDown(login, { key: "End" });
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "Forgot Password" }));
    expect(view.onSelect).not.toHaveBeenCalled();
  });

  it("reorders internal tab drags and ignores unrelated drops", () => {
    const view = structure();
    const source = view.getByRole("tab", { name: "Login" });
    const target = view.getByRole("tab", { name: "Forgot Password" });
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };

    fireEvent.drop(target, { dataTransfer, clientX: 10 });
    expect(view.onReorder).not.toHaveBeenCalled();
    fireEvent.dragStart(source, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe("move");
    const over = createEvent.dragOver(target, { dataTransfer });

    Object.defineProperty(over, "clientX", { value: 10 });
    fireEvent(target, over);
    expect(target.getAttribute("data-drop-position")).toBe("after");
    const drop = createEvent.drop(target, { dataTransfer });

    Object.defineProperty(drop, "clientX", { value: 10 });
    fireEvent(target, drop);
    expect(view.onReorder).toHaveBeenCalledWith("login", "password", true);
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(target.getAttribute("data-drop-position")).toBeNull();
    fireEvent.drop(target, { dataTransfer });
    expect(view.onReorder).toHaveBeenCalledTimes(1);
  });

  it("reorders with Alt+Shift arrows without changing the selected document", () => {
    const view = structure();
    const registration = view.getByRole("tab", { name: "Registration" });

    fireEvent.keyDown(registration, { key: "ArrowLeft", altKey: true, shiftKey: true });
    expect(view.onReorder).toHaveBeenLastCalledWith("registration", "login", false);
    fireEvent.keyDown(registration, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(view.onReorder).toHaveBeenLastCalledWith("registration", "password", true);
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(view.getByRole("tab", { name: "Login" }), {
      key: "ArrowLeft",
      altKey: true,
      shiftKey: true,
    });
    expect(view.onReorder).toHaveBeenCalledTimes(2);
  });

  it("disables document changes while the pane is busy", () => {
    const view = structure(true);

    fireEvent.click(view.getByRole("tab", { name: "Registration" }));
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Add split" }));
    fireEvent.contextMenu(view.getByRole("tab", { name: "Login" }));
    expect(view.queryByRole("menu")).toBeNull();
    expect(view.onAdd).not.toHaveBeenCalled();
    expect(view.onRemove).not.toHaveBeenCalled();
    expect(view.getByRole("tab", { name: "Login" }).getAttribute("draggable")).toBe("false");
    fireEvent.keyDown(view.getByRole("tab", { name: "Login" }), {
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
    });
    expect(view.onReorder).not.toHaveBeenCalled();
  });

  it("disables Add at the 24-workflow limit", () => {
    const view = structure(
      false,
      "split",
      Array.from({ length: 24 }, (_, index) => ({
        id: `workflow-${index}`,
        title: `Workflow ${index}`,
      })),
    );

    expect((view.getByRole("button", { name: "Add split" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("adds a trimmed unique workflow and supports removing a suggested split", async () => {
    const view = structure();

    fireEvent.click(view.getByRole("button", { name: "Add split" }));
    const input = view.getByRole("textbox", { name: "Workflow name" });

    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: " Profile " } });
    fireEvent.click(view.getByRole("button", { name: "Add workflow" }));
    await waitFor(() => expect(view.queryByRole("textbox", { name: "Workflow name" })).toBeNull());
    expect(view.onAdd).toHaveBeenCalledWith("Profile");
    fireEvent.contextMenu(view.getByRole("tab", { name: "Registration" }));
    fireEvent.click(view.getByRole("menuitem", { name: "Delete" }));
    expect(view.onRemove).toHaveBeenCalledWith("registration");
  });

  it("keeps the modal and entered name on save failure so the user can retry", async () => {
    const view = structure();

    view.onAdd.mockResolvedValueOnce(false);
    fireEvent.click(view.getByRole("button", { name: "Add split" }));
    const dialog = view.getByRole("dialog", { name: "Add split" });
    const input = within(dialog).getByRole("textbox", {
      name: "Workflow name",
    }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Profile" } });
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        messages.guide.structureSaveFailed,
      ),
    );
    expect(input.value).toBe("Profile");
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(view.onAdd).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate names and cancels with Escape without changing the plan", () => {
    const view = structure();

    fireEvent.click(view.getByRole("button", { name: "Add split" }));
    const input = view.getByRole("textbox", { name: "Workflow name" });

    fireEvent.change(input, { target: { value: " login " } });
    expect((view.getByRole("button", { name: "Add workflow" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(view.getByRole("alert").textContent).toBe(messages.guide.duplicateSplit);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(view.queryByRole("textbox", { name: "Workflow name" })).toBeNull();
    expect(view.onAdd).not.toHaveBeenCalled();
  });
});
