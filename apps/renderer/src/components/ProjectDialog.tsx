import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  MAX_PROJECT_NAME_LENGTH,
  type ProjectChangeInput,
  type RecordingProject,
} from "@path/shared";
import { Button } from "./Button";

export type ProjectDialogAction =
  | { kind: "create" }
  | { kind: "rename"; project: RecordingProject }
  | { kind: "remove"; project: RecordingProject }
  | { kind: "move"; recordingId: string; projectId: string | null };

export function ProjectDialog({
  action,
  projects,
  change,
  onClose,
}: {
  action: ProjectDialogAction;
  projects: RecordingProject[];
  change(input: ProjectChangeInput): Promise<RecordingProject[]>;
  onClose(): void;
}) {
  const t = useTranslations("projects");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("project" in action ? action.project.name : "");
  const [projectId, setProjectId] = useState(
    action.kind === "move" ? (action.projectId ?? "") : "",
  );

  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("input, select, [data-cancel]")?.focus();

    return () => {
      dialog?.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  async function submit() {
    if (savingRef.current) return;
    if ((action.kind === "create" || action.kind === "rename") && !name.trim()) return;
    savingRef.current = true;
    setIsSaving(true);
    setHasError(false);
    try {
      if (action.kind === "create") {
        await change({ action: "create", name });
      } else if (action.kind === "rename") {
        await change({ action: "rename", id: action.project.id, name });
      } else if (action.kind === "remove") {
        await change({ action: "remove", id: action.project.id });
      } else {
        await change({
          action: "move",
          recordingId: action.recordingId,
          projectId: projectId || null,
        });
      }

      onClose();
    } catch {
      setHasError(true);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="project-dialog"
      aria-labelledby="project-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!savingRef.current) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id="project-dialog-title">
          <Folder size={19} aria-hidden="true" />
          {t(`${action.kind}Title`)}
        </h2>
        {action.kind === "create" || action.kind === "rename" ? (
          <label>
            {t("name")}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_PROJECT_NAME_LENGTH}
              required
              disabled={isSaving}
              placeholder={t("namePlaceholder")}
            />
          </label>
        ) : action.kind === "move" ? (
          <label>
            {t("destination")}
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={isSaving}
            >
              <option value="">{t("ungrouped")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>{t("removeDescription", { name: action.project.name })}</p>
        )}
        {hasError && (
          <p className="project-error" role="alert">
            {t("changeError")}
          </p>
        )}
        <footer>
          <Button
            data-cancel
            type="button"
            variant="secondary"
            disabled={isSaving}
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={
              isSaving || ((action.kind === "create" || action.kind === "rename") && !name.trim())
            }
          >
            {isSaving ? t("saving") : t(`${action.kind}Action`)}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
