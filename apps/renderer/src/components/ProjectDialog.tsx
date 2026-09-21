import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProjectChangeInput, RecordingProject } from "@path/shared";
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

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState(false);

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
    setSaving(true);
    setError(false);
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
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
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
              maxLength={80}
              required
              disabled={saving}
              placeholder={t("namePlaceholder")}
            />
          </label>
        ) : action.kind === "move" ? (
          <label>
            {t("destination")}
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={saving}
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
        {error && (
          <p className="project-error" role="alert">
            {t("changeError")}
          </p>
        )}
        <footer>
          <Button data-cancel type="button" variant="secondary" disabled={saving} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={
              saving || ((action.kind === "create" || action.kind === "rename") && !name.trim())
            }
          >
            {saving ? t("saving") : t(`${action.kind}Action`)}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
