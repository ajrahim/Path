import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { getDesktopApi } from "@/lib/Desktop";
import { getErrorMessage } from "@/lib/ErrorMessage";
import { Button } from "./Button";

export function ClearDataDialog({ onClose }: { onClose(): void }) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isClearingRef = useRef(false);
  const [isClearing, setIsClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-cancel-clear]")?.focus();

    return () => dialog?.close();
  }, []);

  function close(): void {
    if (!isClearingRef.current) onClose();
  }

  async function confirm(): Promise<void> {
    if (isClearingRef.current) return;

    isClearingRef.current = true;
    setIsClearing(true);
    setError(null);

    try {
      const desktop = getDesktopApi();

      if (!desktop) throw new Error(t("settings.clearDataError"));

      await desktop.app.clearData({ confirmed: true });
      // Keep the dialog locked until the desktop has restarted.
    } catch (caught) {
      setError(getErrorMessage(caught, t("settings.clearDataError")));
      isClearingRef.current = false;
      setIsClearing(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="clear-data-dialog"
      aria-labelledby="clear-data-title"
      aria-describedby="clear-data-description"
      aria-busy={isClearing}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="clear-data-title">{t("settings.clearData")}</h2>
      <p id="clear-data-description">{t("settings.clearDataConfirmation")}</p>
      {error && <p role="alert">{error}</p>}
      <footer>
        <Button data-cancel-clear variant="secondary" disabled={isClearing} onClick={close}>
          {t("actions.cancel")}
        </Button>
        <Button variant="danger" disabled={isClearing} onClick={() => void confirm()}>
          <Trash2 aria-hidden="true" size={15} />
          {isClearing ? t("settings.restarting") : t("settings.clearAndRestart")}
        </Button>
      </footer>
    </dialog>
  );
}
