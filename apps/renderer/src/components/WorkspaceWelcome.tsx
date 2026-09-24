import { ArrowUpRight, BookOpen, FileCode2, MessageSquareText, Plus, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "./Button";
import { useInstructionFlows } from "../hooks/useInstructionFlows";

const workflows = [
  { id: "spec-document", key: "specs", Icon: FileCode2 },
  { id: "help-guide", key: "guide", Icon: BookOpen },
  { id: "provide-feedback", key: "feedback", Icon: MessageSquareText },
] as const;

export function WorkspaceWelcome({ onNewRecording }: { onNewRecording(): void }) {
  const t = useTranslations("welcome");
  const flows = useInstructionFlows();

  return (
    <main className="workspace-welcome" aria-labelledby="workspace-welcome-title">
      <div className="workspace-welcome-content">
        <div className="workspace-welcome-intro">
          <div className="workspace-welcome-visual" aria-hidden="true">
            <span className="welcome-document">
              <FileCode2 size={29} strokeWidth={1.4} />
            </span>
            <span className="welcome-video">
              <Video size={34} strokeWidth={1.5} />
            </span>
          </div>
          <div className="workspace-welcome-copy">
            <h1 id="workspace-welcome-title">{t("title")}</h1>
            <p>{t("description")}</p>
            <Button onClick={onNewRecording}>
              <Plus size={16} aria-hidden="true" />
              {t("newRecording")}
            </Button>
            <span className="workspace-welcome-hint">{t("existingHint")}</span>
          </div>
        </div>
        <div className="workspace-welcome-options" aria-label={t("options")}>
          {workflows.map(({ id, key, Icon }) => (
            <button
              type="button"
              className="workspace-welcome-option"
              key={id}
              disabled={!flows.loaded || flows.isBusy}
              onClick={async () => {
                if (await flows.selectFlow(id)) onNewRecording();
              }}
            >
              <span className="welcome-option-top">
                <Icon size={23} strokeWidth={1.5} aria-hidden="true" />
                <ArrowUpRight className="welcome-option-arrow" size={16} aria-hidden="true" />
              </span>
              <strong>{t(`${key}Title`)}</strong>
              <span>{t(`${key}Description`)}</span>
            </button>
          ))}
        </div>
        {flows.error && (
          <p className="workspace-welcome-error" role="alert">
            {flows.error}
          </p>
        )}
      </div>
    </main>
  );
}
