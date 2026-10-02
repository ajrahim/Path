import { useEffect, useId, useRef, useState } from "react";
import { Bot, Brain, Info, LoaderCircle, Rocket, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cliToolNames } from "@path/shared";
import { useCliTools } from "../hooks/useCliTools";
import { getDesktopApi } from "../lib/Desktop";
import { getErrorMessage } from "../lib/ErrorMessage";
import { Button } from "./Button";
import { GuideDeploySelect } from "./GuideDeploySelect";

export function GuideDeployRow({ markdown, disabled }: { markdown: string; disabled: boolean }) {
  const t = useTranslations("guide");
  const cli = useCliTools();
  const { refresh } = cli;
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const selection = cli.state?.deployment.selection;
  const folder = cli.state?.deployment.folder;
  const tools = cli.state?.tools.filter((tool) => tool.connected && tool.status === "ready") ?? [];
  const tool = tools.find((tool) => tool.id === selection?.tool);
  const model = tool?.models.find((model) => model.id === selection?.model);
  const busy = disabled || launching || cli.busy;
  const ready = Boolean(model && folder && markdown.trim());

  useEffect(() => {
    mounted.current = true;
    void refresh();

    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  async function deploy(): Promise<void> {
    const api = getDesktopApi()?.cli;

    if (!api || !ready || busy || pending.current) return;
    pending.current = true;
    setLaunching(true);
    setMessage(null);
    setFailed(false);
    try {
      await api.deploy({ markdown });
      if (mounted.current) setMessage(t("deploymentOpened"));
    } catch (error) {
      if (mounted.current) {
        setFailed(true);
        setMessage(getErrorMessage(error, t("deploymentFailed")));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setLaunching(false);
    }
  }

  return (
    <div className="guide-deployment">
      <div className="guide-deploy-header">
        <div className="guide-deploy-label">{t("deploymentLabel")}</div>
        <span
          className="guide-deploy-help"
          onMouseEnter={() => setHelpOpen(true)}
          onMouseLeave={() => setHelpOpen(false)}
        >
          <button
            type="button"
            className="guide-deploy-info"
            aria-label={t("deploymentInfoLabel")}
            aria-describedby={helpOpen ? helpId : undefined}
            onFocus={() => setHelpOpen(true)}
            onBlur={() => setHelpOpen(false)}
            onClick={() => setHelpOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setHelpOpen(false);
              }
            }}
          >
            <Info size={12} aria-hidden="true" />
          </button>
          {helpOpen && (
            <span id={helpId} role="tooltip" className="guide-deploy-tooltip">
              {t("deploymentInfo")}
            </span>
          )}
        </span>
        <span className="guide-deploy-action" title={folder ?? t("deploymentChooseFolder")}>
          <Button
            className="guide-deploy-button"
            size="sm"
            variant="secondary"
            disabled={busy || !ready}
            onClick={() => void deploy()}
          >
            {launching ? (
              <LoaderCircle size={11} className="guide-chat-spinner" aria-hidden="true" />
            ) : (
              <Rocket size={11} aria-hidden="true" />
            )}
            {t(launching ? "deploying" : "deploy")}
          </Button>
        </span>
      </div>
      <div className="guide-deploy-row">
        <div className="guide-deploy-selects" role="group" aria-label={t("deploymentOptions")}>
          <GuideDeploySelect
            label={t("deploymentCli")}
            value={tool?.id ?? ""}
            text={tool ? cliToolNames[tool.id] : t("deploymentCli")}
            icon={<Terminal size={12} aria-hidden="true" />}
            disabled={busy}
            options={[
              ...tools.map((item) => ({ value: item.id, label: cliToolNames[item.id] })),
              { value: "settings", label: t("deploymentConnect"), action: true },
            ]}
            onSelect={(value) => {
              if (value === "settings") {
                void cli.openSettings();

                return;
              }

              const selected = tools.find((item) => item.id === value);
              const first = selected?.models[0];

              if (selected && first) {
                void cli.selectDeployment({ tool: selected.id, model: first.id, effort: null });
              }
            }}
          />
          <GuideDeploySelect
            label={t("deploymentModel")}
            value={model?.id ?? ""}
            text={model?.name ?? t("deploymentModel")}
            icon={<Bot size={12} aria-hidden="true" />}
            disabled={busy || !tool}
            options={tool?.models.map((item) => ({ value: item.id, label: item.name })) ?? []}
            onSelect={(value) => {
              if (tool) {
                void cli.selectDeployment({ tool: tool.id, model: value, effort: null });
              }
            }}
          />
          <GuideDeploySelect
            label={t("deploymentReasoning")}
            value={selection?.effort ?? ""}
            text={selection?.effort ?? t("deploymentReasoning")}
            icon={<Brain size={12} aria-hidden="true" />}
            disabled={busy || !model?.efforts.length}
            options={[
              { value: "", label: t("deploymentReasoning") },
              ...(model?.efforts.map((effort) => ({ value: effort, label: effort })) ?? []),
            ]}
            onSelect={(value) => {
              if (selection) void cli.selectDeployment({ ...selection, effort: value || null });
            }}
          />
        </div>
      </div>
      {(message || cli.error) && (
        <div className="guide-deploy-message" role={failed || cli.error ? "alert" : "status"}>
          {cli.error ?? message}
        </div>
      )}
    </div>
  );
}
