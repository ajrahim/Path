import { useTranslations } from "next-intl";
import type { DocumentGenerationMode } from "@path/shared";

export function GuideDocumentModeSwitch({
  mode,
  disabled,
  onModeChange,
}: {
  mode: DocumentGenerationMode;
  disabled: boolean;
  onModeChange(mode: DocumentGenerationMode): void;
}) {
  const t = useTranslations("guide");
  const isSplit = mode === "split";

  return (
    <button
      type="button"
      role="switch"
      className="guide-mode-switch"
      aria-label={t("split")}
      aria-checked={isSplit}
      title={t(isSplit ? "combineHint" : "splitHint")}
      disabled={disabled}
      onClick={() => onModeChange(isSplit ? "combine" : "split")}
    >
      <span className={!isSplit ? "guide-mode-active" : undefined} aria-hidden="true">
        {t("combine")}
      </span>
      <span className="guide-mode-track" aria-hidden="true" />
      <span className={isSplit ? "guide-mode-active" : undefined} aria-hidden="true">
        {t("split")}
      </span>
    </button>
  );
}
