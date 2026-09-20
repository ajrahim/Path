import {
  Bot,
  Check,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Settings2,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { AiProvider } from "@path/shared";
import { Button } from "@/components/Button";
import { useSettingsEditor } from "../hooks/useSettingsEditor";
import { useSettingsNavigation } from "../hooks/useSettingsNavigation";

const providers: Array<{ id: AiProvider; name: string; description: string }> = [
  { id: "anthropic", name: "Anthropic", description: "Claude models" },
  { id: "openai", name: "OpenAI", description: "GPT and reasoning models" },
  { id: "google", name: "Google", description: "Gemini models" },
];

export default function SettingsPage() {
  const t = useTranslations();

  // The editor owns drafts and writes; section navigation follows this view's scroll position.
  const {
    settings,
    keyStatus,
    version,
    keyEditor,
    busy,
    notice,
    error,
    isLoading,
    isBusy,
    updateGeneral,
    chooseDirectory,
    openDirectory,
    saveKey,
    removeKey,
    toggleKeyEditor,
    changeKeyDraft,
  } = useSettingsEditor();

  const { contentRef, activeSection, setActiveSection } = useSettingsNavigation(isLoading);
  const { provider: editingProvider, draft: keyDraft } = keyEditor;

  if (isLoading) {
    return (
      <main className="settings-loading">
        <LoaderCircle className="settings-spinner" size={24} />
        <span>{t("settings.loading")}</span>
      </main>
    );
  }

  return (
    <main className="settings-window">
      <header className="settings-titlebar">
        <span className="brand-mark" />
        <strong>{t("settings.title")}</strong>
      </header>
      <div className="settings-shell">
        <aside className="settings-navigation">
          <div>
            <span className="settings-eyebrow">{t("app.name")}</span>
            <h1>{t("settings.title")}</h1>
            <p>{t("settings.subtitle")}</p>
          </div>
          <nav aria-label={t("settings.title")}>
            <a
              href="#general"
              aria-current={activeSection === "general" ? "location" : undefined}
              onClick={() => setActiveSection("general")}
            >
              <Settings2 size={16} />
              {t("settings.general")}
            </a>
            <a
              href="#storage"
              aria-current={activeSection === "storage" ? "location" : undefined}
              onClick={() => setActiveSection("storage")}
            >
              <FolderOpen size={16} />
              {t("settings.storage")}
            </a>
            <a
              href="#keys"
              aria-current={activeSection === "keys" ? "location" : undefined}
              onClick={() => setActiveSection("keys")}
            >
              <KeyRound size={16} />
              {t("settings.apiKeys")}
            </a>
          </nav>
          <span className="settings-version">
            {t("app.name")} {version}
          </span>
        </aside>

        <div className="settings-content" ref={contentRef}>
          {(error || notice) && (
            <div
              className={error ? "settings-banner settings-banner-error" : "settings-banner"}
              role={error ? "alert" : "status"}
            >
              {error ?? notice}
            </div>
          )}

          <section id="general" className="settings-section">
            <SectionHeading
              icon={Settings2}
              title={t("settings.general")}
              description={t("settings.generalDescription")}
            />
            <div className="settings-card">
              <SettingsToggle
                title={t("settings.minimizeToTray")}
                description={t("settings.minimizeToTrayDescription")}
                checked={settings?.general.minimizeToTray ?? true}
                disabled={isBusy || !settings}
                onChange={(minimizeToTray) =>
                  settings && void updateGeneral({ ...settings.general, minimizeToTray })
                }
              />
            </div>
          </section>

          <section id="storage" className="settings-section">
            <SectionHeading
              icon={FolderOpen}
              title={t("settings.storage")}
              description={t("settings.storageDescription")}
            />
            <div className="settings-card settings-storage-card">
              <div className="settings-folder">
                <FolderOpen size={18} />
                <div>
                  <span>{t("settings.recordingsLocation")}</span>
                  <code title={settings?.recordingsDirectory}>
                    {settings?.recordingsDirectory ?? "—"}
                  </code>
                </div>
              </div>
              <div className="settings-card-actions">
                <Button
                  variant="secondary"
                  onClick={() => void openDirectory()}
                  disabled={isBusy || !settings}
                >
                  <ExternalLink size={14} />
                  {t("settings.openFolder")}
                </Button>
                <Button onClick={() => void chooseDirectory()} disabled={isBusy}>
                  {busy === "directory" && <LoaderCircle className="settings-spinner" size={14} />}
                  {t("settings.changeFolder")}
                </Button>
              </div>
              <p className="settings-note">{t("settings.storageNote")}</p>
            </div>
          </section>

          <section id="keys" className="settings-section">
            <SectionHeading
              icon={Bot}
              title={t("settings.apiKeys")}
              description={t("settings.apiKeysDescription")}
            />
            <div className="settings-card settings-provider-list">
              {providers.map((provider) => {
                const configured = keyStatus[provider.id];
                const editing = editingProvider === provider.id;

                return (
                  <div className="settings-provider" key={provider.id}>
                    <div className="settings-provider-summary">
                      <span className={`provider-monogram provider-${provider.id}`}>
                        {provider.name[0]}
                      </span>
                      <div>
                        <strong>{provider.name}</strong>
                        <span>{provider.description}</span>
                      </div>
                      <span
                        className={
                          configured ? "settings-key-status configured" : "settings-key-status"
                        }
                      >
                        {configured && <Check size={12} />}
                        {configured ? t("settings.configured") : t("settings.notConfigured")}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleKeyEditor(provider.id)}
                      >
                        {configured ? t("settings.replaceKey") : t("settings.setKey")}
                      </Button>
                      {configured && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("settings.removeKey")}
                          disabled={isBusy}
                          onClick={() => void removeKey(provider.id)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </div>
                    {editing && (
                      <form
                        className="settings-key-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveKey();
                        }}
                      >
                        <KeyRound size={15} />
                        <input
                          type="password"
                          autoComplete="off"
                          autoFocus
                          value={keyDraft}
                          onChange={(event) => changeKeyDraft(event.target.value)}
                          placeholder={t("guide.providers.keyPlaceholder", {
                            provider: provider.name,
                          })}
                          aria-label={t("guide.providers.apiKey")}
                        />
                        <Button size="sm" type="submit" disabled={!keyDraft.trim() || isBusy}>
                          {busy === `key-${provider.id}` && (
                            <LoaderCircle className="settings-spinner" size={13} />
                          )}
                          {t("guide.providers.saveKey")}
                        </Button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="settings-security-note">
              <KeyRound size={14} />
              {t("settings.keysSecurityNote")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Settings2;
  title: string;
  description: string;
}) {
  return (
    <header className="settings-section-heading">
      <span>
        <Icon size={17} />
      </span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function SettingsToggle({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="settings-toggle-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
