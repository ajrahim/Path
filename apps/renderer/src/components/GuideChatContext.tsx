import { useEffect, useId, useRef, useState } from "react";
import { FileText, ImagePlus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { MAX_GUIDE_CONTEXT_TEXT_LENGTH, type GuideContextItem } from "@path/shared";
import { Button } from "./Button";
import { readGuideContextImage } from "../lib/GuideContextImage";

export function GuideChatContext({
  disabled,
  onAdd,
  onProcessingChange,
}: {
  disabled: boolean;
  onAdd(item: GuideContextItem): void;
  onProcessingChange(processing: boolean): void;
}) {
  const t = useTranslations("guide");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState<"menu" | "text" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (disabled || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    if (open === "text") textRef.current?.focus();
    else firstOptionRef.current?.focus();

    function outside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    }

    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(null);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);

    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function addImage(file: File) {
    setOpen(null);
    setError(false);
    onProcessingChange(true);
    try {
      const item = await readGuideContextImage(file);

      if (mounted.current) onAdd(item);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) {
        restoreFocus.current = true;
        onProcessingChange(false);
      }
    }
  }

  return (
    <div className="guide-chat-context" ref={rootRef}>
      <button
        className="path-button path-button-ghost path-button-size-icon"
        ref={triggerRef}
        type="button"
        title={t("chatAddContext")}
        aria-label={t("chatAddContext")}
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          setError(false);
          setOpen(open ? null : "menu");
        }}
      >
        <Plus aria-hidden="true" size={17} />
      </button>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        aria-label={t("chatAddImage")}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];

          event.target.value = "";
          if (file && !disabled) void addImage(file);
        }}
      />
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={t("chatAddContext")}
          className="guide-chat-context-popover"
        >
          {open === "menu" ? (
            <>
              <button
                ref={firstOptionRef}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setOpen(null);
                  fileRef.current?.click();
                }}
              >
                <ImagePlus size={15} aria-hidden="true" />
                {t("chatAddImage")}
              </button>
              <button type="button" disabled={disabled} onClick={() => setOpen("text")}>
                <FileText size={15} aria-hidden="true" />
                {t("chatAddText")}
              </button>
            </>
          ) : (
            <>
              <textarea
                ref={textRef}
                value={text}
                disabled={disabled}
                maxLength={MAX_GUIDE_CONTEXT_TEXT_LENGTH}
                aria-label={t("chatTextContext")}
                placeholder={t("chatTextContextPlaceholder")}
                onChange={(event) => setText(event.target.value)}
              />
              <div className="guide-chat-context-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(null);
                    triggerRef.current?.focus();
                  }}
                >
                  {t("chatContextCancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={disabled || !text.trim()}
                  onClick={() => {
                    onAdd({ kind: "text", text: text.trim() });
                    setText("");
                    setOpen(null);
                    triggerRef.current?.focus();
                  }}
                >
                  {t("chatContextAdd")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="guide-chat-context-error" role="alert">
          {t("chatImageFailed")}
        </p>
      )}
    </div>
  );
}
