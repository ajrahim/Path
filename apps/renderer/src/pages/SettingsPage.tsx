import { CliSettings } from "../components/CliSettings";
import {
  Bot,
  Check,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Moon,
  Plus,
  Settings2,
  Sparkles,
  Sun,
  Trash2,
  Terminal,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  MAX_TIMELINE_IMPORT_MAX_FILE_SIZE_MB,
  MIN_TIMELINE_IMPORT_MAX_FILE_SIZE_MB,
  type AiProvider,
  type InstructionFlow,
} from "@path/shared";
import { getDesktopApi } from "@/lib/Desktop";
import { Button } from "@/components/Button";
import { useSettingsEditor } from "../hooks/useSettingsEditor";
import { useSettingsNavigation } from "../hooks/useSettingsNavigation";
import { useInstructionFlows } from "../hooks/useInstructionFlows";
import { InstructionFlowEditor } from "../components/InstructionFlowEditor";
import { InstructionFlowGlyph } from "../components/InstructionFlowGlyph";
import { ClearDataDialog } from "../components/ClearDataDialog";

const providers: Array<{ id: AiProvider; name: string; description: string }> = [
  { id: "openrouter", name: "OpenRouter", description: "One key for many models" },
  { id: "anthropic", name: "Anthropic", description: "Claude models" },
  { id: "openai", name: "OpenAI", description: "GPT and reasoning models" },
  { id: "google", name: "Google", description: "Gemini models" },
];

export default function SettingsPage() {
  const t = useTranslations();
  const { resolvedTheme, setTheme } = useTheme();
  const flows = useInstructionFlows({ selectOnCreate: false });
  const promptEditorOpen = flows.editor !== null;
  const [isClearDataOpen, setIsClearDataOpen] = useState(false);

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;

    // Native caption buttons sit above the renderer and need the same dimming as its backdrop.
    void getDesktopApi()?.app.setTitleBarTheme?.({
      theme: resolvedTheme,
      dimmed: promptEditorOpen || isClearDataOpen,
    });
  }, [resolvedTheme, promptEditorOpen, isClearDataOpen]);

  // Keep drafts in the shared shell when navigating between section pages.
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
    updateTimelineImports,
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
              aria-current={activeSection === "general" ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActiveSection("general");
              }}
            >
              <Settings2 size={16} />
              {t("settings.general")}
            </a>
            <a
              href="#storage"
              aria-current={activeSection === "storage" ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActiveSection("storage");
              }}
            >
              <FolderOpen size={16} />
              {t("settings.storage")}
            </a>
            <a
              href="#keys"
              aria-current={activeSection === "keys" ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActiveSection("keys");
              }}
            >
              <KeyRound size={16} />
              {t("settings.apiKeys")}
            </a>
            <a
              href="#prompts"
              aria-current={activeSection === "prompts" ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActiveSection("prompts");
              }}
            >
              <Sparkles size={16} />
              {t("settings.prompts")}
            </a>
            <a
              href="#cli"
              aria-current={activeSection === "cli" ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActiveSection("cli");
              }}
            >
              <Terminal size={16} />
              {t("cli.title")}
            </a>
          </nav>
          <span className="settings-version">
            {t("app.name")} {version}
          </span>
        </aside>

        <div className="settings-content" ref={contentRef}>
          {activeSection === "cli" && <CliSettings />}
          {(error || notice) && (
            <div
              className={error ? "settings-banner settings-banner-error" : "settings-banner"}
              role={error ? "alert" : "status"}
            >
              {error ?? notice}
            </div>
          )}

          {activeSection === "general" && (
            <section
              id="general"
              className="settings-section"
              aria-labelledby="settings-general-title"
            >
              <SectionHeading
                icon={Settings2}
                title={t("settings.general")}
                description={t("settings.generalDescription")}
                id="settings-general-title"
              />
              <div className="settings-card">
                <div className="settings-theme-row">
                  <span>
                    <strong id="settings-theme-label">{t("settings.theme")}</strong>
                    <small>{t("settings.themeDescription")}</small>
                  </span>
                  <div
                    className="settings-theme-options"
                    role="radiogroup"
                    aria-labelledby="settings-theme-label"
                  >
                    {(["light", "dark"] as const).map((theme) => (
                      <label key={theme}>
                        <input
                          type="radio"
                          name="theme"
                          value={theme}
                          checked={resolvedTheme === theme}
                          onChange={() => setTheme(theme)}
                        />
                        <span>
                          {theme === "light" ? (
                            <Sun size={15} aria-hidden="true" />
                          ) : (
                            <Moon size={15} aria-hidden="true" />
                          )}
                          {t(`settings.${theme}Theme`)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <SettingsToggle
                  title={t("settings.minimizeToTray")}
                  description={t("settings.minimizeToTrayDescription")}
                  checked={settings?.general.minimizeToTray ?? true}
                  disabled={isBusy || !settings}
                  onChange={(minimizeToTray) =>
                    settings && void updateGeneral({ ...settings.general, minimizeToTray })
                  }
                />
                {settings && (
                  <SettingsNumberField
                    // Remount after a save so the draft reflects the stored value.
                    key={settings.timelineImports.maxFileSizeMb}
                    title={t("settings.timelineImportLimit")}
                    description={t("settings.timelineImportLimitDescription")}
                    label={t("settings.timelineImportLimitLabel")}
                    unit={t("settings.megabytes")}
                    value={settings.timelineImports.maxFileSizeMb}
                    min={MIN_TIMELINE_IMPORT_MAX_FILE_SIZE_MB}
                    max={MAX_TIMELINE_IMPORT_MAX_FILE_SIZE_MB}
                    disabled={isBusy}
                    onCommit={(maxFileSizeMb) => void updateTimelineImports({ maxFileSizeMb })}
                  />
                )}
              </div>
              <div className="settings-reset">
                <p>{t("settings.clearDataDescription")}</p>
                <Button
                  variant="danger"
                  disabled={isBusy || !settings}
                  onClick={() => setIsClearDataOpen(true)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t("settings.clearData")}
                </Button>
              </div>
            </section>
          )}

          {activeSection === "storage" && (
            <section
              id="storage"
              className="settings-section"
              aria-labelledby="settings-storage-title"
            >
              <SectionHeading
                icon={FolderOpen}
                title={t("settings.storage")}
                description={t("settings.storageDescription")}
                id="settings-storage-title"
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
                    {busy === "directory" && (
                      <LoaderCircle className="settings-spinner" size={14} />
                    )}
                    {t("settings.changeFolder")}
                  </Button>
                </div>
                <p className="settings-note">{t("settings.storageNote")}</p>
              </div>
            </section>
          )}

          {activeSection === "keys" && (
            <section id="keys" className="settings-section" aria-labelledby="settings-keys-title">
              <SectionHeading
                icon={Bot}
                title={t("settings.apiKeys")}
                description={t("settings.apiKeysDescription")}
                id="settings-keys-title"
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
          )}

          {activeSection === "prompts" && (
            <section
              id="prompts"
              className="settings-section"
              aria-labelledby="settings-prompts-title"
            >
              <div className="settings-prompts-heading">
                <SectionHeading
                  icon={Sparkles}
                  title={t("settings.prompts")}
                  description={t("settings.promptsDescription")}
                  id="settings-prompts-title"
                />
                <Button
                  disabled={!flows.loaded || flows.isBusy}
                  onClick={() => void flows.selectFlow("create")}
                >
                  <Plus size={15} aria-hidden="true" />
                  {t("guide.newPrompt")}
                </Button>
              </div>
              {flows.error && (
                <div className="settings-banner settings-banner-error" role="alert">
                  {flows.error}
                </div>
              )}
              {!flows.loaded ? (
                <p className="settings-note" role="status">
                  {t("settings.promptsLoading")}
                </p>
              ) : (
                <>
                  <PromptGroup
                    id="default-prompts"
                    title={t("settings.defaultPrompts")}
                    flows={flows.builtInFlows}
                    disabled={flows.isBusy}
                    onEdit={flows.editFlow}
                  />
                  <PromptGroup
                    id="custom-prompts"
                    title={t("guide.customFlows")}
                    flows={flows.customFlows}
                    disabled={flows.isBusy}
                    onEdit={flows.editFlow}
                    emptyMessage={t("settings.noCustomPrompts")}
                  />
                </>
              )}
            </section>
          )}
        </div>
      </div>
      <InstructionFlowEditor flows={flows} />
      {isClearDataOpen && <ClearDataDialog onClose={() => setIsClearDataOpen(false)} />}
    </main>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
  id,
}: {
  icon: typeof Settings2;
  title: string;
  description: string;
  id: string;
}) {
  return (
    <header className="settings-section-heading">
      <span>
        <Icon size={17} />
      </span>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

function PromptGroup({
  id,
  title,
  flows,
  disabled,
  onEdit,
  emptyMessage,
}: {
  id: string;
  title: string;
  flows: InstructionFlow[];
  disabled: boolean;
  onEdit(id: string): void;
  emptyMessage?: string;
}) {
  const t = useTranslations();

  return (
    <section className="settings-prompt-group" aria-labelledby={id}>
      <div className="settings-prompt-group-heading">
        <h3 id={id}>{title}</h3>
      </div>
      {flows.length === 0 ? (
        <p className="settings-prompts-empty">{emptyMessage}</p>
      ) : (
        <div className="settings-card settings-prompt-list">
          {flows.map((flow) => (
            <button
              key={flow.id}
              type="button"
              className="settings-prompt-row"
              disabled={disabled}
              aria-label={t("settings.editNamedPrompt", { name: flow.name })}
              onClick={() => onEdit(flow.id)}
            >
              <span className="settings-prompt-glyph">
                <InstructionFlowGlyph icon={flow.icon} size={18} aria-hidden="true" />
              </span>
              <span className="settings-prompt-name">{flow.name}</span>
              <span className="settings-prompt-edit">{t("settings.editPromptAction")}</span>
            </button>
          ))}
        </div>
      )}
    </section>
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

/** Whole-number setting; commits a valid changed value on Enter or blur and reverts otherwise. */
function SettingsNumberField({
  title,
  description,
  label,
  unit,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  title: string;
  description: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(value.toString());

  function commit(): void {
    const next = Number(draft.trim());

    if (!draft.trim() || !Number.isInteger(next) || next < min || next > max || next === value) {
      setDraft(value.toString());

      return;
    }

    onCommit(next);
  }

  return (
    <div className="settings-number-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <label>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }

            if (event.key === "Escape") setDraft(value.toString());
          }}
        />
        <span aria-hidden="true">{unit}</span>
      </label>
    </div>
  );
}
