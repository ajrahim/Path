import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, Search, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cliToolNames, type CliToolId } from "@path/shared";
import type { useCliTools } from "../hooks/useCliTools";

export function CliToolPicker({ cli }: { cli: ReturnType<typeof useCliTools> }) {
  const t = useTranslations("cli");
  const navigation = useTranslations("navigation");
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Partial<Record<CliToolId, boolean>>>({});
  const [effortOpen, setEffortOpen] = useState(true);
  const search = query.trim().toLowerCase();
  const selection = cli.state?.mode === "cli" ? cli.state.selection : null;
  const tools = cli.state?.tools ?? [];
  const selectedTool = tools.find((tool) => tool.id === selection?.tool);
  const selectedModel = selectedTool?.models.find((model) => model.id === selection?.model);
  const ready = selectedTool?.connected && selectedTool.status === "ready";
  const visibleTools = tools.filter(
    (tool) =>
      !search ||
      cliToolNames[tool.id].toLowerCase().includes(search) ||
      tool.models.some((model) => `${model.name} ${model.id}`.toLowerCase().includes(search)),
  );

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function changeQuery(value: string): void {
    setQuery(value);
    setExpanded({});
  }

  return (
    <div className="cli-tool-picker">
      <div className="local-model-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          aria-label={navigation("searchModels")}
          placeholder={navigation("searchModels")}
        />
        {query && (
          <button
            type="button"
            aria-label={navigation("clearModelSearch")}
            onClick={() => {
              changeQuery("");
              searchRef.current?.focus();
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="local-model-results">
        {visibleTools.length === 0 && <p role="status">{navigation("noMatchingModels")}</p>}
        {visibleTools.map((tool) => {
          const isExpanded = expanded[tool.id] ?? (Boolean(search) || selection?.tool === tool.id);
          const models = tool.models.filter(
            (model) =>
              !search ||
              cliToolNames[tool.id].toLowerCase().includes(search) ||
              `${model.name} ${model.id}`.toLowerCase().includes(search),
          );

          const modelsId = `${listId}-${tool.id}`;

          return (
            <section className="local-api-provider" key={tool.id}>
              <button
                type="button"
                className="local-api-provider-toggle cli-list-toggle"
                aria-label={`${cliToolNames[tool.id]} ${t(tool.connected ? "ready" : "disconnected")}`}
                aria-expanded={isExpanded}
                aria-controls={modelsId}
                onClick={() => setExpanded((current) => ({ ...current, [tool.id]: !isExpanded }))}
              >
                <ChevronRight size={15} aria-hidden="true" />
                <span>{cliToolNames[tool.id]}</span>
                <span className="cli-connection-status" title={t(tool.status)}>
                  {t(tool.connected ? "ready" : "disconnected")}
                </span>
              </button>
              {isExpanded && (
                <div
                  id={modelsId}
                  className="local-api-provider-models"
                  role="menu"
                  aria-label={cliToolNames[tool.id]}
                >
                  {tool.connected && tool.status === "ready" ? (
                    models.map((model) => {
                      const checked = selection?.tool === tool.id && selection.model === model.id;

                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={checked}
                          className="local-model-option"
                          title={model.description || model.id}
                          disabled={cli.busy}
                          onClick={() =>
                            void cli.select({
                              tool: tool.id,
                              model: model.id,
                              effort: checked ? selection.effort : null,
                            })
                          }
                        >
                          <span>{model.name}</span>
                          {checked && <Check size={15} aria-hidden="true" />}
                        </button>
                      );
                    })
                  ) : (
                    <button
                      type="button"
                      className="local-model-configure-keys"
                      onClick={() => void cli.openSettings()}
                    >
                      <Settings size={14} aria-hidden="true" />
                      <span>{tool.connected ? t(tool.status) : t("connectInSettings")}</span>
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
        <section className="local-api-provider cli-effort-group">
          <button
            type="button"
            className="local-api-provider-toggle"
            aria-expanded={effortOpen}
            aria-controls={`${listId}-efforts`}
            onClick={() => setEffortOpen((value) => !value)}
          >
            <ChevronRight size={15} aria-hidden="true" />
            <span>{t("effort")}</span>
          </button>
          {effortOpen && (
            <div
              id={`${listId}-efforts`}
              className="local-api-provider-models"
              role="menu"
              aria-label={t("effort")}
            >
              {selection && selectedModel?.efforts.length ? (
                [null, ...selectedModel.efforts].map((effort) => (
                  <button
                    key={effort ?? "default"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selection.effort === effort}
                    className="local-model-option"
                    disabled={cli.busy || !ready}
                    onClick={() => void cli.select({ ...selection, effort })}
                  >
                    <span>
                      {effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : t("default")}
                    </span>
                    {selection.effort === effort && <Check size={15} aria-hidden="true" />}
                  </button>
                ))
              ) : (
                <p>{t(selection ? "noEffort" : "chooseModelForEffort")}</p>
              )}
            </div>
          )}
        </section>
        {cli.error && <p role="alert">{cli.error}</p>}
      </div>
      <button
        type="button"
        className="local-model-configure-keys cli-connections-link"
        onClick={() => void cli.openSettings()}
      >
        <Settings size={14} aria-hidden="true" />
        <span>{t("connections")}</span>
      </button>
    </div>
  );
}
