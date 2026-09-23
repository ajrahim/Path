import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<AiModelPurpose, HTMLButtonElement | null>>({
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
  const selectionSummary = t("modelSelectionSummary", {
    visual: selections.visual?.modelName ?? t("chooseModel"),
    text: selections.text?.modelName ?? t("chooseModel"),
  });

  function changePurpose(nextPurpose: AiModelPurpose): void {
    setPurpose(nextPurpose);
    setQuery("");
  }

  function navigatePurposes(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    let nextPurpose: AiModelPurpose;

    if (event.key === "Home") {
      nextPurpose = "visual";
    } else if (event.key === "End") {
      nextPurpose = "text";
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      nextPurpose = purpose === "visual" ? "text" : "visual";
    } else {
      return;
    }

    event.preventDefault();
    changePurpose(nextPurpose);
    tabRefs.current[nextPurpose]?.focus();
  }

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
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function chooseModel(selection: AiModelSelection): Promise<void> {
    if (await selectModel(purpose, selection)) {
      setOpen(false);
      triggerRef.current?.focus();
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
      <button
        type="button"
        ref={triggerRef}
        className="local-model-trigger"
        aria-label={t("selectAiModel")}
        aria-describedby={`${menuId}-selection-summary`}
        title={selectionSummary}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!open) setQuery("");
          setOpen((current) => !current);
        }}
      >
        <span className="local-model-trigger-choice">
          <Eye aria-hidden="true" size={13} />
          <span className="local-model-trigger-name">
            {selections.visual?.modelName ?? t("visualModel")}
          </span>
        </span>
        <span className="local-model-trigger-divider" aria-hidden="true" />
        <span className="local-model-trigger-choice">
          <FileText aria-hidden="true" size={13} />
          <span className="local-model-trigger-name">
            {selections.text?.modelName ?? t("textModel")}
          </span>
        </span>
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <span className="sr-only" id={`${menuId}-selection-summary`}>
        {selectionSummary}
      </span>
      {open && (
        <div className="local-model-menu" id={menuId} role="dialog" aria-label={t("aiModels")}>
          <header>
            <span>{t("aiModels")}</span>
            <button
              type="button"
              title={t("refreshAiModels")}
              aria-label={t("refreshAiModels")}
              disabled={isLoading || isSaving}
              onClick={() => void refreshCatalog()}
            >
              <RefreshCw aria-hidden="true" size={14} />
            </button>
          </header>
          <div className="local-model-purposes" role="tablist" aria-label={t("modelPurpose")}>
            {MODEL_PURPOSES.map((modelPurpose) => (
              <button
                key={modelPurpose}
                ref={(element) => {
                  tabRefs.current[modelPurpose] = element;
                }}
                type="button"
                role="tab"
                id={`${menuId}-${modelPurpose}-tab`}
                aria-controls={`${menuId}-${modelPurpose}-panel`}
                aria-selected={purpose === modelPurpose}
                aria-label={t(modelPurpose === "visual" ? "visualModel" : "textModel")}
                aria-describedby={`${menuId}-${modelPurpose}-selection`}
                tabIndex={purpose === modelPurpose ? 0 : -1}
                onClick={() => changePurpose(modelPurpose)}
                onKeyDown={navigatePurposes}
              >
                <span>{t(modelPurpose === "visual" ? "visualModel" : "textModel")}</span>
                <small
                  id={`${menuId}-${modelPurpose}-selection`}
                  title={selections[modelPurpose]?.modelName}
                >
                  {selections[modelPurpose]?.modelName ?? t("chooseModel")}
                </small>
              </button>
            ))}
          </div>
          <div
            className="local-model-panel"
            role="tabpanel"
            id={`${menuId}-${purpose}-panel`}
            aria-labelledby={`${menuId}-${purpose}-tab`}
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
                          <p>{t(purpose === "visual" ? "noApiVisualModels" : "noApiTextModels")}</p>
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
                                purpose === "visual" ? "noLocalVisionModels" : "noLocalTextModels",
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
          <div
            role="tabpanel"
            id={`${menuId}-${purpose === "visual" ? "text" : "visual"}-panel`}
            aria-labelledby={`${menuId}-${purpose === "visual" ? "text" : "visual"}-tab`}
            hidden
          />
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
