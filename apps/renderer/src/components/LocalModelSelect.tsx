import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  RefreshCw,
  Search,
  Settings,
  TriangleAlert,
  Terminal,
  X,
} from "lucide-react";
import type {
  AiModelPurpose,
  AiModelSelection,
  AiProvider,
  ApiAiModel,
  LocalAiModel,
} from "@path/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useCliTools } from "../hooks/useCliTools";
import { CliToolPicker } from "./CliToolPicker";
import { useAiModels } from "../hooks/useAiModels";
import type { ModelCatalogProvider } from "../lib/ModelCatalog";

const DIRECT_API_PROVIDERS: ReadonlyArray<{ id: AiProvider; label: string }> = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
];

const MODEL_PURPOSES: readonly AiModelPurpose[] = ["visual", "text"];

export function LocalModelSelect({
  disabled,
  catalog,
}: {
  disabled: boolean;
  catalog?: ModelCatalogProvider;
}) {
  const t = useTranslations("navigation");
  const format = useFormatter();
  const cli = useCliTools();
  const cliText = useTranslations("cli");
  const [textView, setTextView] = useState<"model" | "cli">("model");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRefs = useRef<Record<AiModelPurpose, HTMLButtonElement | null>>({
    visual: null,
    text: null,
  });

  const [purpose, setPurpose] = useState<AiModelPurpose>("visual");
  const [query, setQuery] = useState("");
  const {
    models,
    keyStatus,
    selections,
    isLoading,
    isSaving,
    error,
    refreshModels,
    selectModel,
    openKeySettings,
  } = useAiModels(catalog);

  const [expandedProvider, setExpandedProvider] = useState<AiProvider | null>(null);
  const [open, setOpen] = useState(false);
  const selection = selections[purpose];

  async function refreshCatalog(): Promise<void> {
    const status = await refreshModels();

    // A removed API key also removes that provider's expanded model list.
    if (status) setExpandedProvider((current) => (current && status[current] ? current : null));
  }

  useEffect(() => {
    if (!open) return;

    searchRef.current?.focus();

    function closeMenu(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRefs.current[purpose]?.focus();
      }
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, purpose]);

  async function chooseModel(selection: AiModelSelection): Promise<void> {
    if (await selectModel(purpose, selection)) {
      if (purpose === "text" && cli.state?.mode === "cli" && !(await cli.setMode("model"))) return;
      setOpen(false);
      triggerRefs.current[purpose]?.focus();
    }
  }

  function openSettingsKeys(): void {
    setOpen(false);
    void openKeySettings();
  }

  function formatLocalMeta(model: LocalAiModel): string | null {
    const parts: string[] = [];
    const size = formatBytes(model.sizeBytes);

    if (size) parts.push(size);

    if (model.modifiedAt) {
      const modified = Date.parse(model.modifiedAt);

      if (!Number.isNaN(modified)) parts.push(format.relativeTime(new Date(modified), new Date()));
    }

    if (model.isLoaded) parts.push(t("modelLoaded"));

    return parts.length > 0 ? parts.join(" · ") : null;
  }

  function formatApiMeta(model: ApiAiModel): string | null {
    const parts: string[] = [];

    if (model.vendor) parts.push(model.vendor);

    if (model.pricing) {
      parts.push(
        t("modelPricing", {
          prompt: formatUsd(model.pricing.promptPerMillion),
          completion: formatUsd(model.pricing.completionPerMillion),
        }),
      );
    }

    if (model.contextLength) {
      parts.push(t("modelContext", { tokens: formatContext(model.contextLength) }));
    }

    if (model.isFree) parts.push(t("freeModel"));

    return parts.length > 0 ? parts.join(" · ") : null;
  }

  const search = query.trim().toLocaleLowerCase();
  const matchesSearch = (name: string, id: string, extra = "") =>
    `${name} ${id} ${extra}`.toLocaleLowerCase().includes(search);

  const compatibleApiModels = models.api.filter((model) =>
    model.supportedPurposes.includes(purpose),
  );

  const localModels = models.local.filter(
    (model) => model.supportedPurposes.includes(purpose) && matchesSearch(model.name, model.id),
  );

  const openRouterModels = compatibleApiModels.filter(
    (model) =>
      model.provider === "openrouter" && matchesSearch(model.name, model.id, model.vendor ?? ""),
  );

  const configuredProviders = DIRECT_API_PROVIDERS.filter((provider) => keyStatus[provider.id]);
  const visibleProviders = configuredProviders.filter(
    (provider) =>
      !search ||
      compatibleApiModels.some(
        (model) =>
          model.provider === provider.id && matchesSearch(model.name, model.id, provider.label),
      ),
  );

  const noMatches =
    Boolean(search) &&
    localModels.length === 0 &&
    visibleProviders.length === 0 &&
    openRouterModels.length === 0;

  const ollamaDown = models.ollama.status === "unavailable";
  const staleLocalSelection =
    selection?.source === "local" &&
    !isLoading &&
    !ollamaDown &&
    !models.local.some((model) => model.id === selection.modelId);

  const staleApiSelection =
    selection?.source === "api" &&
    !isLoading &&
    !compatibleApiModels.some(
      (model) => model.provider === selection.provider && model.id === selection.modelId,
    );

  return (
    <div className="local-model-select" ref={rootRef}>
      {MODEL_PURPOSES.map((modelPurpose) => {
        const label = t(modelPurpose === "visual" ? "visualModel" : "textModel");
        const usingCli = modelPurpose === "text" && cli.state?.mode === "cli";
        const cliSelection = cli.state?.selection;
        const cliName =
          cli.state?.tools
            .find((tool) => tool.id === cliSelection?.tool)
            ?.models.find((model) => model.id === cliSelection?.model)?.name ?? cliSelection?.model;

        const modelName =
          (usingCli ? cliName : selections[modelPurpose]?.modelName) ?? t("chooseModel");

        const expanded = open && purpose === modelPurpose;
        const Icon = modelPurpose === "visual" ? Eye : usingCli ? Terminal : FileText;

        return (
          <button
            key={modelPurpose}
            type="button"
            ref={(element) => {
              triggerRefs.current[modelPurpose] = element;
            }}
            id={`${menuId}-${modelPurpose}-trigger`}
            className="local-model-trigger"
            aria-label={label}
            title={`${label}: ${modelName}`}
            aria-haspopup="dialog"
            aria-expanded={expanded}
            aria-controls={expanded ? menuId : undefined}
            disabled={disabled || isSaving}
            onClick={() => {
              if (expanded) {
                setOpen(false);

                return;
              }

              setPurpose(modelPurpose);
              if (modelPurpose === "text") {
                setTextView(cli.state?.mode ?? "model");
                void cli.refresh();
              }

              setQuery("");
              setExpandedProvider(null);
              setOpen(true);
              // The chat picker shares these selections; refresh when either picker opens.
              void refreshCatalog();
            }}
          >
            <span className="local-model-trigger-choice">
              <Icon aria-hidden="true" size={13} />
              <span className="local-model-trigger-name">
                {modelName === t("chooseModel") ? label : modelName}
              </span>
            </span>
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        );
      })}
      {open && (
        <div
          className={`local-model-menu${purpose === "text" ? " local-model-menu-text" : ""}`}
          id={menuId}
          role="dialog"
          aria-label={t(purpose === "visual" ? "visualModels" : "textModels")}
        >
          <header>
            <span>{t(purpose === "visual" ? "visualModels" : "textModels")}</span>
            <button
              type="button"
              title={t("refreshAiModels")}
              aria-label={t("refreshAiModels")}
              disabled={isLoading || isSaving || cli.busy}
              onClick={() => {
                void refreshCatalog();
                if (purpose === "text") void cli.refresh();
              }}
            >
              <RefreshCw aria-hidden="true" size={14} />
            </button>
          </header>
          {purpose === "text" && (
            <div className="local-model-source-tabs" role="tablist" aria-label={cliText("source")}>
              {(["model", "cli"] as const).map((source) => (
                <button
                  type="button"
                  role="tab"
                  key={source}
                  id={`${menuId}-${source}-tab`}
                  aria-selected={textView === source}
                  aria-controls={`${menuId}-source-panel`}
                  tabIndex={textView === source ? 0 : -1}
                  disabled={cli.busy}
                  onClick={() => {
                    setTextView(source);
                    if (source === "cli") void cli.refresh();
                    else if (cli.state?.mode === "cli") void cli.setMode("model");
                  }}
                  onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? "model"
                        : event.key === "End"
                          ? "cli"
                          : source === "model"
                            ? "cli"
                            : "model";

                    const button = document.getElementById(
                      `${menuId}-${next}-tab`,
                    ) as HTMLButtonElement | null;

                    button?.click();
                    button?.focus();
                  }}
                >
                  {cliText(source === "model" ? "textModel" : "cliTool")}
                </button>
              ))}
            </div>
          )}
          {purpose === "text" && textView === "cli" ? (
            <div
              role="tabpanel"
              id={`${menuId}-source-panel`}
              aria-labelledby={`${menuId}-cli-tab`}
              className="local-model-cli-panel"
            >
              <CliToolPicker cli={cli} />
            </div>
          ) : (
            <div
              className="local-model-panel"
              role={purpose === "text" ? "tabpanel" : undefined}
              id={purpose === "text" ? `${menuId}-source-panel` : undefined}
              aria-labelledby={purpose === "text" ? `${menuId}-model-tab` : undefined}
            >
              <div className="local-model-search">
                <Search size={14} aria-hidden="true" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t("searchModels")}
                  placeholder={t("searchModels")}
                />
                {query && (
                  <button
                    type="button"
                    aria-label={t("clearModelSearch")}
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div
                className="local-model-results"
                role="menu"
                aria-label={t(purpose === "visual" ? "visualModels" : "textModels")}
              >
                {isLoading ? (
                  <p>{t("checkingAiModels")}</p>
                ) : error ? (
                  <p role="alert">{t("aiModelsUnavailable")}</p>
                ) : noMatches ? (
                  <p role="status">{t("noMatchingModels")}</p>
                ) : (
                  <>
                    {(!search || visibleProviders.length > 0 || openRouterModels.length > 0) && (
                      <section className="local-model-group" aria-label={t("apiModels")}>
                        <strong>{t("apiModels")}</strong>
                        {staleApiSelection && (
                          <p className="local-model-warning" role="alert">
                            <TriangleAlert size={14} aria-hidden="true" />
                            <span>
                              {t(
                                purpose === "visual"
                                  ? "staleVisualApiModelSelected"
                                  : "staleTextApiModelSelected",
                              )}
                            </span>
                          </p>
                        )}
                        {openRouterModels.length > 0 && (
                          <OpenRouterBlock
                            menuId={menuId}
                            models={openRouterModels}
                            hasKey={keyStatus.openrouter}
                            expanded={Boolean(search) || expandedProvider === "openrouter"}
                            selection={selection}
                            isSaving={isSaving}
                            onToggle={() =>
                              setExpandedProvider(
                                expandedProvider === "openrouter" ? null : "openrouter",
                              )
                            }
                            describeModel={formatApiMeta}
                            onChoose={(model) => {
                              if (!keyStatus.openrouter) {
                                openSettingsKeys();

                                return;
                              }

                              void chooseModel({
                                source: "api",
                                provider: "openrouter",
                                modelId: model.id,
                                modelName: model.name,
                              });
                            }}
                          />
                        )}
                        {configuredProviders.length === 0 && openRouterModels.length === 0 ? (
                          keyStatus.openrouter ? (
                            <p>
                              {t(purpose === "visual" ? "noApiVisualModels" : "noApiTextModels")}
                            </p>
                          ) : (
                            <button
                              type="button"
                              className="local-model-configure-keys"
                              onClick={openSettingsKeys}
                            >
                              <Settings aria-hidden="true" size={14} />
                              <span>{t("noApiModels")}</span>
                            </button>
                          )
                        ) : (
                          visibleProviders.map((provider) => {
                            const providerModels = compatibleApiModels.filter(
                              (model) =>
                                model.provider === provider.id &&
                                matchesSearch(model.name, model.id, provider.label),
                            );

                            const expanded = Boolean(search) || expandedProvider === provider.id;
                            const providerModelsId = `${menuId}-${provider.id}-models`;

                            return (
                              <div className="local-api-provider" key={provider.id}>
                                <button
                                  type="button"
                                  className="local-api-provider-toggle"
                                  aria-expanded={expanded}
                                  aria-controls={providerModelsId}
                                  onClick={() => setExpandedProvider(expanded ? null : provider.id)}
                                >
                                  <ChevronRight aria-hidden="true" size={15} />
                                  <span>{provider.label}</span>
                                  <small>{providerModels.length}</small>
                                </button>
                                {expanded && (
                                  <div className="local-api-provider-models" id={providerModelsId}>
                                    {providerModels.length === 0 ? (
                                      <p>
                                        {t(
                                          purpose === "visual"
                                            ? "noApiVisualModels"
                                            : "noApiTextModels",
                                        )}
                                      </p>
                                    ) : (
                                      providerModels.map((model) => (
                                        <ApiModelOption
                                          key={model.id}
                                          model={model}
                                          meta={formatApiMeta(model)}
                                          checked={
                                            selection?.source === "api" &&
                                            selection.provider === provider.id &&
                                            selection.modelId === model.id
                                          }
                                          disabled={isSaving}
                                          onChoose={() =>
                                            void chooseModel({
                                              source: "api",
                                              provider: provider.id,
                                              modelId: model.id,
                                              modelName: model.name,
                                            })
                                          }
                                        />
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </section>
                    )}
                    {(!search || localModels.length > 0) && (
                      <section className="local-model-group" aria-label={t("localModels")}>
                        <div className="local-model-group-heading">
                          <strong>{t("localModels")}</strong>
                          <span
                            className={`local-model-status${ollamaDown ? " is-down" : ""}`}
                            title={models.ollama.endpoint ?? undefined}
                            aria-label={
                              models.ollama.endpoint
                                ? `${ollamaDown ? t("ollamaUnavailable") : t("ollamaRunning")}, ${models.ollama.endpoint}`
                                : undefined
                            }
                          >
                            <span className="status-dot" aria-hidden="true" />
                            <span>{ollamaDown ? t("ollamaUnavailable") : t("ollamaRunning")}</span>
                          </span>
                        </div>
                        {staleLocalSelection && (
                          <p className="local-model-warning" role="alert">
                            <TriangleAlert size={14} aria-hidden="true" />
                            <span>
                              {t(
                                purpose === "visual"
                                  ? "staleVisualModelSelected"
                                  : "staleTextModelSelected",
                              )}
                            </span>
                          </p>
                        )}
                        {localModels.length === 0
                          ? !ollamaDown && (
                              <p>
                                {t(
                                  purpose === "visual"
                                    ? "noLocalVisionModels"
                                    : "noLocalTextModels",
                                )}
                              </p>
                            )
                          : localModels.map((model) => {
                              const checked =
                                selection?.source === "local" && selection.modelId === model.id;

                              const meta = formatLocalMeta(model);

                              return (
                                <button
                                  type="button"
                                  className="local-model-option"
                                  role="menuitemradio"
                                  aria-checked={checked}
                                  aria-label={meta ? `${model.name}, ${meta}` : undefined}
                                  title={meta ?? undefined}
                                  disabled={isSaving}
                                  key={model.id}
                                  onClick={() =>
                                    void chooseModel({
                                      source: "local",
                                      modelId: model.id,
                                      modelName: model.name,
                                    })
                                  }
                                >
                                  <span>{model.name}</span>
                                  {checked && <Check aria-hidden="true" size={14} />}
                                </button>
                              );
                            })}
                      </section>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OpenRouterBlock({
  menuId,
  models,
  hasKey,
  expanded,
  selection,
  isSaving,
  onToggle,
  onChoose,
  describeModel,
}: {
  menuId: string;
  models: ApiAiModel[];
  hasKey: boolean;
  expanded: boolean;
  selection: AiModelSelection | null;
  isSaving: boolean;
  onToggle(): void;
  onChoose(model: ApiAiModel): void;
  describeModel(model: ApiAiModel): string | null;
}) {
  const t = useTranslations("navigation");
  const modelsId = `${menuId}-openrouter-models`;

  return (
    <div className="local-api-provider">
      <button
        type="button"
        className="local-api-provider-toggle"
        aria-expanded={expanded}
        aria-controls={modelsId}
        onClick={onToggle}
      >
        <ChevronRight aria-hidden="true" size={15} />
        <span>
          {t("openRouterModels")}
          {!hasKey && <span className="local-api-provider-note"> ({t("noApiKey")})</span>}
        </span>
        <small>{models.length}</small>
      </button>
      {expanded && (
        <div className="local-api-provider-models" id={modelsId}>
          {models.map((model) => (
            <ApiModelOption
              key={model.id}
              model={model}
              meta={describeModel(model)}
              checked={
                selection?.source === "api" &&
                selection.provider === "openrouter" &&
                selection.modelId === model.id
              }
              disabled={isSaving}
              onChoose={() => onChoose(model)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApiModelOption({
  model,
  meta,
  checked,
  disabled,
  onChoose,
}: {
  model: ApiAiModel;
  meta: string | null;
  checked: boolean;
  disabled: boolean;
  onChoose(): void;
}) {
  return (
    <button
      type="button"
      className="local-model-option"
      role="menuitemradio"
      aria-checked={checked}
      aria-label={meta ? `${model.name}, ${meta}` : undefined}
      title={meta ?? undefined}
      disabled={disabled}
      onClick={onChoose}
    >
      <span>{model.name}</span>
      {checked && <Check aria-hidden="true" size={14} />}
    </button>
  );
}

function formatBytes(sizeBytes: number | null): string | null {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null;

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log10(Math.max(sizeBytes, 1)) / 3), units.length - 1);
  const value = sizeBytes / 1024 ** unit;

  return `${Number(value.toFixed(value >= 100 || unit === 0 ? 0 : 1))} ${units[unit]}`;
}

function formatUsd(perMillion: number): string {
  return Number(perMillion.toPrecision(2)).toString();
}

function formatContext(contextLength: number): string {
  if (contextLength < 1000) return String(contextLength);

  const thousands = contextLength / 1000;

  return `${Number(thousands.toFixed(thousands >= 100 ? 0 : 1))}K`;
}
