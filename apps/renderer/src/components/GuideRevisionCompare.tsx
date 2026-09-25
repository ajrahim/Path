import { useEffect, useMemo, useRef } from "react";
import { GitCompare } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";
import { diffLines } from "@/lib/LineDiff";

const CHANGE_MARKERS = { added: "+", removed: "−", same: " " } as const;

// Embedded images are single very long lines; show enough to recognize them.
const MAX_DISPLAYED_LINE_LENGTH = 240;

function displayLine(text: string): string {
  return text.length > MAX_DISPLAYED_LINE_LENGTH
    ? `${text.slice(0, MAX_DISPLAYED_LINE_LENGTH - 1)}…`
    : text;
}

/** Read-only line comparison between a stored revision and the editor's current text. */
export function GuideRevisionCompare({
  revisionNumber,
  revisionMarkdown,
  currentMarkdown,
  onClose,
}: {
  revisionNumber: number;
  revisionMarkdown: string;
  currentMarkdown: string;
  onClose(): void;
}) {
  const t = useTranslations("guide");
  const dialogRef = useRef<HTMLDivElement>(null);
  const changes = useMemo(
    () => diffLines(revisionMarkdown, currentMarkdown),
    [revisionMarkdown, currentMarkdown],
  );

  const addedCount = changes.filter((change) => change.type === "added").length;
  const removedCount = changes.filter((change) => change.type === "removed").length;

  useEffect(() => {
    // Keyboard focus moves into the dialog so Escape and Tab act on it immediately.
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop guide-instructions-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="guide-instructions-dialog guide-compare-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-compare-title"
      >
        <header className="prompt-editor-header">
          <GitCompare aria-hidden="true" size={20} />
          <div>
            <h2 id="guide-compare-title">{t("compareTitle", { number: revisionNumber })}</h2>
            <p>{t("compareSummary", { added: addedCount, removed: removedCount })}</p>
          </div>
        </header>
        <ol className="guide-compare-lines" aria-label={t("compareChanges")}>
          {changes.map((change, index) => (
            <li key={index} className={`guide-compare-line guide-compare-${change.type}`}>
              <span aria-hidden="true" className="guide-compare-marker">
                {CHANGE_MARKERS[change.type]}
              </span>
              <span className="sr-only">{t(`compareLine.${change.type}`)}</span>
              <span className="guide-compare-text">{displayLine(change.text) || " "}</span>
            </li>
          ))}
        </ol>
        <footer>
          <Button variant="secondary" onClick={onClose}>
            {t("compareClose")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
