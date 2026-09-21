import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RecordingSummary } from "@path/shared";
import { Button } from "./Button";

export function RecordingDeleteDialog({
  recording,
  onConfirm,
  onClose,
}: {
  recording: RecordingSummary;
  onConfirm(recording: RecordingSummary): Promise<void>;
  onClose(): void;
}) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-cancel-delete]")?.focus();

    return () => dialog?.close();
  }, [recording.id]);

  function close(): void {
    if (!deletingRef.current) onClose();
  }

  async function confirm(): Promise<void> {
    if (deletingRef.current) return;

    deletingRef.current = true;
    setDeleting(true);
    setError(null);

    try {
      await onConfirm(recording);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("history.deleteError"));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="recording-delete-dialog"
      aria-labelledby="recording-delete-title"
      aria-describedby="recording-delete-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="recording-delete-title">{t("history.deleteTitle")}</h2>
      <p className="recording-delete-name">{recording.title}</p>
      <p id="recording-delete-description">{t("history.deleteDescription")}</p>
      {error && (
        <p className="settings-inline-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <Button data-cancel-delete variant="secondary" disabled={deleting} onClick={close}>
          {t("actions.cancel")}
        </Button>
        <Button variant="danger" disabled={deleting} onClick={() => void confirm()}>
          <Trash2 aria-hidden="true" size={15} />
          {deleting ? t("history.deleting") : t("actions.delete")}
        </Button>
      </footer>
    </dialog>
  );
}
