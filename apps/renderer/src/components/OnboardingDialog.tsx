import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  HardDrive,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  Monitor,
  MousePointerClick,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AiModelPurpose, AiProvider } from "@path/shared";
import { useTranslations } from "next-intl";
import { useAiModels } from "@/hooks/useAiModels";
import { useCliTools } from "@/hooks/useCliTools";
import { getDesktopApi } from "@/lib/Desktop";
import { getErrorMessage } from "@/lib/ErrorMessage";
import { getModelReadiness, type ModelReadiness } from "@/lib/ModelReadiness";
import { Button } from "./Button";
import { LocalModelSelect } from "./LocalModelSelect";

export type OnboardingSettingsSection = "keys" | "storage";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

const STEPS = [
  { id: "welcome", Icon: Sparkles },
  { id: "models", Icon: Eye },
  { id: "record", Icon: Video },
  { id: "review", Icon: ListChecks },
  { id: "generate", Icon: FileText },
] as const satisfies ReadonlyArray<{ id: string; Icon: LucideIcon }>;

type OnboardingStepId = (typeof STEPS)[number]["id"];

const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
};

interface OnboardingDialogProps {
  /** Skip, Escape, and Done all finish onboarding. */
  onClose(): void;
  onStartRecording(): void;
  onOpenSettings(section: OnboardingSettingsSection): void;
}

export function OnboardingDialog({
  onClose,
  onStartRecording,
  onOpenSettings,
}: OnboardingDialogProps) {
  const t = useTranslations("onboarding");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");

  const step = STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === STEPS.length - 1;

  useEffect(() => {
    const dialog = dialogRef.current;

    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-onboarding-next]")?.focus();

    return () => dialog?.close();
  }, []);

  // Footer buttons swap on the first and last steps; keep focus inside the dialog when they do.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog || dialog.contains(document.activeElement)) return;

    dialog.querySelector<HTMLButtonElement>("[data-onboarding-next]")?.focus();
  }, [stepIndex]);

  function goToStep(index: number): void {
    const nextIndex = Math.min(STEPS.length - 1, Math.max(0, index));

    if (nextIndex === stepIndex) return;

    setDirection(nextIndex > stepIndex ? "forward" : "backward");
    setStepIndex(nextIndex);
  }

  function changeStepWithKeyboard(event: React.KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (
      event.defaultPrevented ||
      (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
    ) {
      return;
    }

    event.preventDefault();
    goToStep(stepIndex + (event.key === "ArrowLeft" ? -1 : 1));
  }

  return (
    <dialog
      ref={dialogRef}
      className="onboarding-dialog"
      aria-label={t("label")}
      aria-describedby={descriptionId}
      onKeyDown={changeStepWithKeyboard}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="onboarding-header">
        <span className="onboarding-brand">
          <Image src="/icons/Icon64.png" alt="" width={24} height={24} />
          <span>{t("brand")}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t(isLastStep ? "done" : "skip")}
          <X size={14} aria-hidden="true" />
        </Button>
      </header>

      <section
        key={step.id}
        className={`onboarding-slide onboarding-slide-${direction} onboarding-slide-${step.id}`}
        aria-labelledby={titleId}
      >
        <div className="onboarding-slide-content">
          {isFirstStep ? (
            <div className="onboarding-art" aria-hidden="true">
              <Image
                className="onboarding-art-light"
                src="/onboarding/WorkflowLight.png"
                alt=""
                width={1400}
                height={500}
              />
              <Image
                className="onboarding-art-dark"
                src="/onboarding/WorkflowDark.png"
                alt=""
                width={1400}
                height={500}
              />
            </div>
          ) : (
            <span className="onboarding-slide-icon" aria-hidden="true">
              <step.Icon size={32} strokeWidth={1.5} />
            </span>
          )}
          <div className="onboarding-intro">
            <h2 id={titleId}>{t(`${step.id}Title`)}</h2>
            <p id={descriptionId} className="onboarding-slide-description">
              {t(`${step.id}Description`)}
            </p>
          </div>
          <OnboardingStepBody stepId={step.id} onOpenSettings={onOpenSettings} />
        </div>
      </section>

      <footer className="onboarding-footer">
        <Button
          variant="ghost"
          className={isFirstStep ? "onboarding-back-hidden" : undefined}
          disabled={isFirstStep}
          onClick={() => goToStep(stepIndex - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          {t("back")}
        </Button>
        <div className="onboarding-progress">
          <span className="onboarding-step-count" aria-live="polite">
            {t("stepCount", { current: stepIndex + 1, total: STEPS.length })}
            <span className="sr-only">: {t(`${step.id}Title`)}</span>
          </span>
          <div className="onboarding-dots" role="group" aria-label={t("steps")}>
            {STEPS.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                className="onboarding-dot"
                aria-label={t("goToStep", {
                  number: index + 1,
                  title: t(`${candidate.id}Title`),
                })}
                aria-current={index === stepIndex ? "step" : undefined}
                onClick={() => goToStep(index)}
              />
            ))}
          </div>
        </div>
        <div className="onboarding-primary-actions">
          {isLastStep ? (
            <Button key="start" data-onboarding-next onClick={onStartRecording}>
              <Plus size={16} aria-hidden="true" />
              {t("startRecording")}
            </Button>
          ) : (
            <Button key="next" data-onboarding-next onClick={() => goToStep(stepIndex + 1)}>
              {t("next")}
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </footer>
    </dialog>
  );
}

function OnboardingStepBody({
  stepId,
  onOpenSettings,
}: {
  stepId: OnboardingStepId;
  onOpenSettings(section: OnboardingSettingsSection): void;
}) {
  switch (stepId) {
    case "welcome":
      return <WelcomeStep />;

    case "models":
      return <ModelsStep onOpenSettings={onOpenSettings} />;

    case "record":
      return <RecordStep onOpenSettings={onOpenSettings} />;

    case "review":
      return (
        <FeatureList
          items={[
            [MousePointerClick, "reviewTimeline"],
            [PencilLine, "reviewEdit"],
          ]}
        />
      );

    case "generate":
      return (
        <FeatureList
          items={[
            [MessageSquareText, "generateChat"],
            [ExternalLink, "generateExport"],
          ]}
        />
      );
  }
}

function WelcomeStep() {
  const t = useTranslations("onboarding");
  const stages = [
    { Icon: Video, key: "welcomeRecord" },
    { Icon: ListChecks, key: "welcomeReview" },
    { Icon: FileText, key: "welcomeGenerate" },
  ] as const;

  return (
    <ol className="onboarding-stages">
      {stages.map(({ Icon, key }) => (
        <li key={key}>
          <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
          <strong>{t(key)}</strong>
          <span>{t(`${key}Description`)}</span>
        </li>
      ))}
    </ol>
  );
}

function ModelsStep({
  onOpenSettings,
}: {
  onOpenSettings(section: OnboardingSettingsSection): void;
}) {
  const t = useTranslations("onboarding");
  const navigation = useTranslations("navigation");
  const aiModels = useAiModels();
  const cli = useCliTools();
  const purposes: readonly AiModelPurpose[] = ["visual", "text"];

  const modelReadiness = purposes.map((purpose) => ({
    purpose,
    readiness: getModelReadiness({
      purpose,
      selection: aiModels.selections[purpose],
      models: aiModels.models,
      keyStatus: aiModels.keyStatus,
      isLoading: aiModels.isLoading,
      cli: cli.state,
    }),
  }));

  const allReady = modelReadiness.every(({ readiness }) => readiness.status === "ready");

  const refreshOnFocus = useEffectEvent(() => void aiModels.refreshModels());

  // Keys are added in the Settings window; recheck when the user returns to this one.
  useEffect(() => {
    const listener = () => refreshOnFocus();

    window.addEventListener("focus", listener);

    return () => window.removeEventListener("focus", listener);
  }, []);

  return (
    <div className="onboarding-models">
      <div className="onboarding-model-status">
        <div className="onboarding-model-status-header">
          <strong>{t(allReady ? "modelsReady" : "modelStatus")}</strong>
          <Button
            variant="ghost"
            size="sm"
            disabled={aiModels.isLoading || aiModels.isSaving}
            onClick={() => void aiModels.refreshModels()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {t("checkAgain")}
          </Button>
        </div>
        <ul>
          {modelReadiness.map(({ purpose, readiness }) => (
            <li key={purpose}>
              <span className="onboarding-model-purpose">
                {navigation(purpose === "visual" ? "visualModel" : "textModel")}
              </span>
              <ModelReadinessLabel readiness={readiness} />
            </li>
          ))}
        </ul>
        <div className="onboarding-model-picker">
          <LocalModelSelect
            disabled={aiModels.isSaving}
            onSelectionChange={() => void aiModels.refreshModels()}
          />
        </div>
        {aiModels.error && <p role="alert">{aiModels.error}</p>}
      </div>
      <div className="onboarding-model-actions">
        {/* The main window opens new-window web links in the system browser. */}
        <Button asChild variant="secondary" size="sm">
          <a href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            <HardDrive size={16} aria-hidden="true" />
            {t("getOllama")}
            <ExternalLink size={14} aria-hidden="true" />
            <span className="sr-only">{t("opensInBrowser")}</span>
          </a>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onOpenSettings("keys")}>
          <KeyRound size={16} aria-hidden="true" />
          {t("addApiKey")}
        </Button>
      </div>
    </div>
  );
}

function ModelReadinessLabel({ readiness }: { readiness: ModelReadiness }) {
  const t = useTranslations("onboarding");

  if (readiness.status === "checking") {
    return (
      <span className="onboarding-readiness onboarding-readiness-checking">
        <LoaderCircle size={14} aria-hidden="true" />
        {t("checking")}
      </span>
    );
  }

  if (readiness.status === "ready") {
    return (
      <span className="onboarding-readiness onboarding-readiness-ready">
        <CircleCheck size={14} aria-hidden="true" />
        {t("ready")}
      </span>
    );
  }

  return (
    <span className="onboarding-readiness onboarding-readiness-needs-setup">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>
        <strong>{t("needsSetup")}</strong>
        <span className="onboarding-readiness-detail">
          <ReadinessDetail readiness={readiness} />
        </span>
      </span>
    </span>
  );
}

function ReadinessDetail({
  readiness,
}: {
  readiness: Exclude<ModelReadiness, { status: "checking" | "ready" }>;
}) {
  const t = useTranslations("onboarding");

  switch (readiness.status) {
    case "not-chosen":
      return t("notChosen");

    case "ollama-unavailable":
      return t("ollamaUnavailable", { model: readiness.modelName });

    case "model-missing":
      return t.rich("modelMissing", {
        model: readiness.modelName,
        modelId: readiness.modelId,
        code: (chunks: ReactNode) => <code>{chunks}</code>,
      });

    case "key-missing":
      return t("keyMissing", {
        model: readiness.modelName,
        provider: PROVIDER_NAMES[readiness.provider],
      });

    case "cli-unavailable":
      return t("cliUnavailable", { model: readiness.modelName });
  }
}

function RecordStep({
  onOpenSettings,
}: {
  onOpenSettings(section: OnboardingSettingsSection): void;
}) {
  const t = useTranslations("onboarding");
  const [directory, setDirectory] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const settings = getDesktopApi()?.settings;

    void (settings?.get() ?? Promise.resolve(null))
      .then((snapshot) => {
        if (snapshot && request === requestRef.current) setDirectory(snapshot.recordingsDirectory);
      })
      .catch((cause: unknown) => {
        if (request === requestRef.current) setError(getErrorMessage(cause, t("folderError")));
      })
      .finally(() => {
        if (request === requestRef.current) setBusy(false);
      });

    return () => {
      requestRef.current += 1;
    };
  }, [t]);

  async function chooseFolder(): Promise<void> {
    const settings = getDesktopApi()?.settings;

    if (!settings) {
      onOpenSettings("storage");

      return;
    }

    if (busy) return;

    const request = ++requestRef.current;

    setBusy(true);
    setError(null);
    try {
      const snapshot = await settings.chooseRecordingsDirectory();

      if (snapshot && request === requestRef.current) setDirectory(snapshot.recordingsDirectory);
    } catch (cause) {
      if (request === requestRef.current) setError(getErrorMessage(cause, t("folderError")));
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }

  return (
    <div className="onboarding-record">
      <FeatureList
        items={[
          [Monitor, "recordSources"],
          [MousePointerClick, "recordClicks"],
        ]}
      />
      <div className="onboarding-folder">
        <FolderOpen size={20} aria-hidden="true" />
        <span>
          <strong>{t("recordFolder")}</strong>
          <span title={directory ?? undefined}>{directory ?? t("chooseFolderHint")}</span>
        </span>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void chooseFolder()}>
          {busy && <LoaderCircle size={14} aria-hidden="true" />}
          {t("changeFolder")}
        </Button>
      </div>
      {error && (
        <p className="onboarding-folder-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type FeatureKey =
  | "recordSources"
  | "recordClicks"
  | "reviewTimeline"
  | "reviewEdit"
  | "generateChat"
  | "generateExport";

function FeatureList({ items }: { items: ReadonlyArray<readonly [LucideIcon, FeatureKey]> }) {
  const t = useTranslations("onboarding");

  return (
    <ul className="onboarding-features">
      {items.map(([Icon, key]) => (
        <li key={key}>
          <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
          <span>
            <strong>{t(`${key}Title`)}</strong>
            <span>{t(key)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
