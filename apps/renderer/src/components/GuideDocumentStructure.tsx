import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import {
  hasDuplicateWorkflowTitle,
  isWorkflowTitleLengthValid,
  MAX_GENERATED_DOCUMENTS,
  MAX_WORKFLOW_TITLE_LENGTH,
  type DocumentGenerationMode,
  type DocumentWorkflow,
} from "@path/shared";
import { Button } from "./Button";
import { HistoryMenu } from "./HistoryMenu";

export function GuideDocumentStructure({
  mode,
  workflows,
  activeDocumentId,
  disabled,
  onSelect,
  onAdd,
  onRemove,
  onRename,
  onReorder,
}: {
  mode: DocumentGenerationMode;
  workflows: Pick<DocumentWorkflow, "id" | "title">[];
  activeDocumentId: string | null;
  disabled: boolean;
  onSelect(id: string): void;
  onAdd(title: string): Promise<boolean>;
  onRemove(id: string): void;
  onRename(id: string, title: string): Promise<boolean>;
  onReorder(id: string, targetId: string, placeAfter: boolean): Promise<boolean>;
}) {
  const t = useTranslations("guide");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    workflowId: string;
    x: number;
    y: number;
    trigger: HTMLButtonElement;
  } | null>(null);

  const [hasSaveFailed, setHasSaveFailed] = useState(false);
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggedIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    placeAfter: boolean;
  } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const trimmedName = name.trim();
  const isDuplicate = hasDuplicateWorkflowTitle(workflows, trimmedName, renamingId);

  const canSubmit =
    !disabled &&
    Boolean(trimmedName) &&
    isWorkflowTitleLengthValid(trimmedName) &&
    !isDuplicate &&
    (renamingId !== null || workflows.length < MAX_GENERATED_DOCUMENTS);

  const menuWorkflow = workflows.find((workflow) => workflow.id === contextMenu?.workflowId);

  useEffect(() => {
    if (!isDialogOpen) return;
    const dialog = dialogRef.current;
    const opener = openerRef.current;

    dialog?.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();

    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, [isDialogOpen]);

  function closeDialog(): void {
    setIsDialogOpen(false);
    setName("");
    setHasSaveFailed(false);
    setRenamingId(null);
  }

  function openContextMenu(
    workflowId: string,
    trigger: HTMLButtonElement,
    x: number,
    y: number,
  ): void {
    if (disabled || isDialogOpen) return;

    setContextMenu({ workflowId, trigger, x, y });
  }

  /** Tabs reorder with Alt+Shift+arrows; plain arrows, Home, and End only move focus. */
  function onTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    workflowId: string,
    index: number,
  ): void {
    if (event.altKey && event.shiftKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      if (disabled || isDialogOpen) return;

      const placeAfter = event.key === "ArrowRight";
      const neighbor = workflows[index + (placeAfter ? 1 : -1)];

      if (neighbor) void onReorder(workflowId, neighbor.id, placeAfter);

      return;
    }

    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();

      openContextMenu(workflowId, event.currentTarget, bounds.left, bounds.bottom);

      return;
    }

    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next =
      (index + (event.key === "ArrowRight" ? 1 : -1) + workflows.length) % workflows.length;

    if (event.key === "Home") next = 0;
    if (event.key === "End") next = workflows.length - 1;

    event.currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  function onTabDragStart(event: ReactDragEvent<HTMLButtonElement>, workflowId: string): void {
    if (disabled || isDialogOpen) {
      event.preventDefault();

      return;
    }

    closeContextMenu();
    draggedIdRef.current = workflowId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-path-workflow", workflowId);
  }

  function onTabDragOver(event: ReactDragEvent<HTMLButtonElement>, workflowId: string): void {
    if (disabled || isDialogOpen || !draggedIdRef.current) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (draggedIdRef.current === workflowId) {
      setDropTarget(null);

      return;
    }

    setDropTarget({ id: workflowId, placeAfter: isAfterTabMidpoint(event) });
  }

  function onTabDragLeave(event: ReactDragEvent<HTMLButtonElement>): void {
    const isStillInsideTab =
      event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);

    if (!isStillInsideTab) setDropTarget(null);
  }

  function onTabDrop(event: ReactDragEvent<HTMLButtonElement>, workflowId: string): void {
    const sourceId = draggedIdRef.current;

    clearDrag();
    if (disabled || isDialogOpen || !sourceId) return;

    event.preventDefault();
    void onReorder(sourceId, workflowId, isAfterTabMidpoint(event));
  }

  function clearDrag(): void {
    draggedIdRef.current = null;
    setDropTarget(null);
  }

  return (
    <section className="guide-document-structure" aria-label={t("documentStructure")}>
      <div className="guide-structure-row">
        {mode === "split" && workflows.length > 0 && (
          <div className="guide-document-tabs" role="tablist" aria-label={t("documents")}>
            {workflows.map((workflow, index) => (
              <button
                key={workflow.id}
                type="button"
                role="tab"
                id={`guide-document-${workflow.id}`}
                aria-selected={activeDocumentId === workflow.id}
                aria-controls="guide-document-editor"
                tabIndex={activeDocumentId === workflow.id ? 0 : -1}
                disabled={disabled}
                title={workflow.title}
                aria-describedby={`${id}-reorder-help`}
                draggable={!disabled && !isDialogOpen}
                data-drop-position={getDropPosition(dropTarget, workflow.id)}
                onDragStart={(event) => onTabDragStart(event, workflow.id)}
                onDragOver={(event) => onTabDragOver(event, workflow.id)}
                onDragLeave={onTabDragLeave}
                onDrop={(event) => onTabDrop(event, workflow.id)}
                onDragEnd={clearDrag}
                onClick={() => onSelect(workflow.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openContextMenu(workflow.id, event.currentTarget, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => onTabKeyDown(event, workflow.id, index)}
              >
                {workflow.title}
              </button>
            ))}
          </div>
        )}
        {mode === "split" && (
          <button
            type="button"
            className="guide-split-add"
            title={t("addSplit")}
            aria-label={t("addSplit")}
            disabled={disabled || isDialogOpen || workflows.length >= MAX_GENERATED_DOCUMENTS}
            onClick={(event) => {
              openerRef.current = event.currentTarget;
              setIsDialogOpen(true);
            }}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      <span id={`${id}-reorder-help`} className="sr-only">
        {t("reorderSplitHint")}
      </span>
      {mode === "split" && isDialogOpen && (
        <dialog
          ref={dialogRef}
          className="recording-delete-dialog guide-split-dialog"
          aria-labelledby={`${id}-title`}
          onCancel={(event) => {
            event.preventDefault();
            if (!disabled) closeDialog();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (!disabled) closeDialog();
          }}
        >
          <form
            className="guide-split-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;

              const save =
                renamingId === null ? onAdd(trimmedName) : onRename(renamingId, trimmedName);

              void save.then((isSaved) => {
                if (isSaved) closeDialog();
                else setHasSaveFailed(true);
              });
            }}
          >
            <h2 id={`${id}-title`}>{t(renamingId === null ? "addSplit" : "renameSplit")}</h2>
            <label className="guide-split-field" htmlFor={`${id}-name`}>
              {t("splitName")}
              <input
                id={`${id}-name`}
                ref={inputRef}
                value={name}
                maxLength={MAX_WORKFLOW_TITLE_LENGTH}
                disabled={disabled}
                aria-invalid={isDuplicate}
                aria-describedby={isDuplicate || hasSaveFailed ? `${id}-error` : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setHasSaveFailed(false);
                }}
              />
            </label>
            {(isDuplicate || hasSaveFailed) && (
              <div id={`${id}-error`} className="guide-split-validation" role="alert">
                {t(isDuplicate ? "duplicateSplit" : "structureSaveFailed")}
              </div>
            )}
            <footer>
              <Button type="button" variant="secondary" disabled={disabled} onClick={closeDialog}>
                {t("cancelSplit")}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {renamingId === null ? (
                  <Plus size={15} aria-hidden="true" />
                ) : (
                  <Pencil size={15} aria-hidden="true" />
                )}
                {t(renamingId === null ? "confirmSplit" : "rename")}
              </Button>
            </footer>
          </form>
        </dialog>
      )}
      <HistoryMenu
        label={t("splitActions", { title: menuWorkflow?.title ?? "" })}
        anchor={
          contextMenu && menuWorkflow && !disabled && !isDialogOpen
            ? { x: contextMenu.x, y: contextMenu.y }
            : null
        }
        onClose={closeContextMenu}
        returnFocus={() => contextMenu?.trigger.focus()}
        items={
          menuWorkflow && contextMenu
            ? [
                {
                  label: t("rename"),
                  icon: <Pencil size={14} aria-hidden="true" />,
                  disabled,
                  onSelect: () => {
                    openerRef.current = contextMenu.trigger;
                    setRenamingId(menuWorkflow.id);
                    setName(menuWorkflow.title);
                    setIsDialogOpen(true);
                  },
                },
                {
                  label: t("delete"),
                  icon: <Trash2 size={14} aria-hidden="true" />,
                  danger: true,
                  disabled,
                  onSelect: () => onRemove(menuWorkflow.id),
                },
              ]
            : []
        }
      />
    </section>
  );
}

/** A tab drops after its neighbour when the pointer passes the tab's midpoint. */
function isAfterTabMidpoint(event: ReactDragEvent<HTMLButtonElement>): boolean {
  const bounds = event.currentTarget.getBoundingClientRect();

  return event.clientX >= bounds.left + bounds.width / 2;
}

function getDropPosition(
  dropTarget: { id: string; placeAfter: boolean } | null,
  workflowId: string,
): "before" | "after" | undefined {
  if (dropTarget?.id !== workflowId) return undefined;

  return dropTarget.placeAfter ? "after" : "before";
}
