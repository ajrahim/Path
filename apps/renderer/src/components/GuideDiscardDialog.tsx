import { useId, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Button } from "./Button";

export function GuideDiscardDialog({
  dialogRef,
  title,
  description,
  isBusy,
  onCancel,
  onDiscard,
  onSave,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  title: string;
  description: string;
  isBusy: boolean;
  onCancel(): void;
  onDiscard(): void;
  onSave(): void;
}) {
  const t = useTranslations();
  const id = useId();

  return (
    <dialog
      ref={dialogRef}
      className="recording-delete-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!isBusy) onCancel();
      }}
    >
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-description`}>{description}</p>
      <footer>
        <Button data-cancel-switch variant="secondary" disabled={isBusy} onClick={onCancel}>
          {t("actions.cancel")}
        </Button>
        <Button variant="ghost" disabled={isBusy} onClick={onDiscard}>
          {t("guide.discard")}
        </Button>
        <Button disabled={isBusy} onClick={onSave}>
          {isBusy ? t("guide.saving") : t("guide.saveAndSwitch")}
        </Button>
      </footer>
    </dialog>
  );
}
