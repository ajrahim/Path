import { useEffect } from "react";
import { Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cliToolIds, cliToolNames } from "@path/shared";
import { useCliTools } from "../hooks/useCliTools";
import { Button } from "./Button";

export function CliSettings() {
  const t = useTranslations("cli");
  const cli = useCliTools();

  const { refresh } = cli;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="settings-section" id="cli">
      <div className="settings-section-heading">
        <span className="settings-section-icon">
          <Terminal size={18} />
        </span>
        <div>
          <h2>{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
      </div>
      <div className="settings-card cli-connections">
        {cliToolIds.map((id) => {
          const status = cli.state?.tools.find((item) => item.id === id);

          return (
            <div className="cli-connection-row" key={id}>
              <div>
                <strong>{cliToolNames[id]}</strong>
                <p>{status ? t(status.status) : t("checking")}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={cli.busy || !status?.installed}
                onClick={() => void cli.connect(id, !status?.connected)}
              >
                {t(status?.connected ? "disconnect" : "connect")}
              </Button>
            </div>
          );
        })}
      </div>
      {cli.error && (
        <p role="alert" className="settings-banner settings-banner-error">
          {cli.error}
        </p>
      )}
      <p className="cli-sign-in-help">{t("signInHelp")}</p>
      <Button size="sm" variant="ghost" disabled={cli.busy} onClick={() => void cli.refresh()}>
        {t("refresh")}
      </Button>
    </section>
  );
}
