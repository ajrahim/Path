import { useRef, useState } from "react";
import type { RecordingSummary } from "@path/shared";

export function RecordingRenameField({
  recording,
  pending,
  onSave,
  onCancel,
}: {
  recording: RecordingSummary;
  pending: boolean;
  onSave(title: string): Promise<void>;
  onCancel(): void;
}) {
  const [draftTitle, setDraftTitle] = useState(recording.title);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    const title = draftTitle.trim();

    if (!title || savingRef.current || pending) return;

    savingRef.current = true;
    setSaving(true);

    try {
      await onSave(title);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <input
      className="rename-input"
      disabled={saving || pending}
      value={draftTitle}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setDraftTitle(event.target.value)}
      onBlur={() => {
        if (draftTitle.trim()) void save();
        else onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") void save();
        if (event.key === "Escape") onCancel();
      }}
      autoFocus
    />
  );
}
