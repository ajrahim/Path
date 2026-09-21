import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  HardDrive,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type { AiModelSelection, AiProvider } from "@path/shared";
import { useTranslations } from "next-intl";
import { useAiModels } from "../hooks/useAiModels";

const API_PROVIDERS: ReadonlyArray<{ id: AiProvider; label: string }> = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google" },
];

export function LocalModelSelect({ disabled }: { disabled: boolean }) {
  const t = useTranslations("navigation");
  const providerT = useTranslations("guide.providers");
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const { models, keyStatus, selection, isLoading, isSaving, error, refreshModels, selectModel } =
    useAiModels();

  const [expandedProvider, setExpandedProvider] = useState<AiProvider | null>(null);
  const [open, setOpen] = useState(false);

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
    if (await selectModel(selection)) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const search = query.trim().toLocaleLowerCase();
  const matchesSearch = (name: string, id: string, provider = "") =>
    `${name} ${id} ${provider}`.toLocaleLowerCase().includes(search);

  const localModels = models.local.filter((model) => matchesSearch(model.name, model.id));
  const configuredProviders = API_PROVIDERS.filter((provider) => keyStatus[provider.id]);
  const visibleProviders = configuredProviders.filter(
    (provider) =>
      !search ||
      models.api.some(
        (model) =>
          model.provider === provider.id && matchesSearch(model.name, model.id, provider.label),
      ),
  );

  const noMatches = Boolean(search) && localModels.length === 0 && visibleProviders.length === 0;

  return (
    <div className="local-model-select" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="local-model-trigger"
        aria-label={t("selectAiModel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!open) setQuery("");
          setOpen((current) => !current);
        }}
      >
        {selection?.source === "api" ? (
          <Cloud aria-hidden="true" size={14} />
        ) : (
          <HardDrive aria-hidden="true" size={14} />
        )}
        <span>{selection?.modelName ?? t("aiModel")}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
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
          <div className="local-model-results" role="menu" aria-label={t("aiModels")}>
            {isLoading ? (
              <p>{t("checkingAiModels")}</p>
            ) : error ? (
              <p role="alert">{t("aiModelsUnavailable")}</p>
            ) : noMatches ? (
              <p role="status">{t("noMatchingModels")}</p>
            ) : (
              <>
                {(!search || visibleProviders.length > 0) && (
                  <section className="local-model-group" aria-label={t("apiModels")}>
                    <strong>{t("apiModels")}</strong>
                    {configuredProviders.length === 0 ? (
                      <p>{t("noApiModels")}</p>
                    ) : (
                      visibleProviders.map((provider) => {
                        const providerModels = models.api.filter(
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
                                  <p>{providerT("noModels")}</p>
                                ) : (
                                  providerModels.map((model) => {
                                    const checked =
                                      selection?.source === "api" &&
                                      selection.provider === provider.id &&
                                      selection.modelId === model.id;

                                    return (
                                      <button
                                        type="button"
                                        className="local-model-option"
                                        role="menuitemradio"
                                        aria-checked={checked}
                                        disabled={isSaving}
                                        key={model.id}
                                        onClick={() =>
                                          void chooseModel({
                                            source: "api",
                                            provider: provider.id,
                                            modelId: model.id,
                                            modelName: model.name,
                                          })
                                        }
                                      >
                                        <span>{model.name}</span>
                                        {checked && <Check aria-hidden="true" size={14} />}
                                      </button>
                                    );
                                  })
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
                    <strong>{t("localModels")}</strong>
                    {localModels.length === 0 ? (
                      <p>{t("noLocalVisionModels")}</p>
                    ) : (
                      localModels.map((model) => {
                        const checked =
                          selection?.source === "local" && selection.modelId === model.id;

                        return (
                          <button
                            type="button"
                            className="local-model-option"
                            role="menuitemradio"
                            aria-checked={checked}
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
                      })
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
