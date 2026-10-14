import { useEffect, useId, useRef, useState } from "react";
import { FileText, Folder, LoaderCircle, Mic, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCliTools } from "../hooks/useCliTools";
import { Button } from "./Button";
import { GuideChatContext } from "./GuideChatContext";
import { MAX_GUIDE_CONTEXT_ITEMS, type GuideContextItem } from "@path/shared";

// Minimal Web Speech API typing; recognition stays unsupported where the browser omits it.
interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative | undefined;
  length: number;
}

interface SpeechRecognitionResults {
  [index: number]: SpeechRecognitionResult | undefined;
  length: number;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResults;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;

  const candidate = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/** Chat-style follow-up input that sends document update requests to the text model. */
export function GuideChatInput({
  updating,
  disabled,
  onSend,
}: {
  updating: boolean;
  disabled: boolean;
  onSend(
    prompt: string,
    context: GuideContextItem[],
    contextFolder?: string,
  ): void | boolean | Promise<boolean | void>;
}) {
  const t = useTranslations("guide");
  const contextFolderHintId = useId();
  const cli = useCliTools();
  const contextFolder = cli.state?.deployment.folder ?? null;
  const [hasFolderError, setHasFolderError] = useState(false);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const canReadFolder =
    cli.state?.mode === "cli" &&
    Boolean(cli.state.selection && cli.state.connected.includes(cli.state.selection.tool));

  const folderHint = contextFolder ?? t("deploymentFolderHint");

  const [context, setContext] = useState<GuideContextItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [hasSendError, setHasSendError] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const dictationBaseRef = useRef("");
  const isBusy = disabled || updating || isProcessing || isSending || isChoosingFolder;
  const supported = getSpeechRecognition() !== null;

  useEffect(() => {
    return () => recognitionRef.current?.abort();
  }, []);

  async function send(): Promise<void> {
    const request = prompt.trim();

    if (!request || isBusy) return;

    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
    }

    setIsSending(true);
    setHasSendError(false);
    try {
      const sent = await (canReadFolder && contextFolder
        ? onSend(request, context, contextFolder)
        : onSend(request, context));

      if (sent !== false) {
        setPrompt("");
        setContext([]);
      }
    } catch {
      setHasSendError(true);
    } finally {
      setIsSending(false);
    }
  }

  function toggleDictation(): void {
    if (isBusy || isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);

      return;
    }

    const Recognition = getSpeechRecognition();

    if (!Recognition) return;

    const recognition = new Recognition();

    dictationBaseRef.current = prompt.trim();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = typeof navigator === "undefined" ? "en-US" : (navigator.language ?? "en-US");
    recognition.onresult = (event) => {
      let transcript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript ?? "";
      }

      const base = dictationBaseRef.current;
      const dictated = transcript.trim();

      setPrompt(base && dictated ? `${base} ${dictated}` : dictated || base);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    recognition.onerror = () => {
      recognitionRef.current = null;
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch {
      return;
    }

    recognitionRef.current = recognition;
    setIsListening(true);
  }

  return (
    <div className="guide-chat">
      {hasFolderError && (
        <p className="guide-chat-error" role="alert">
          {t("chatChooseFolderFailed")}
        </p>
      )}
      {hasSendError && (
        <p className="guide-chat-error" role="alert">
          {t("chatContextSendFailed")}
        </p>
      )}
      <div className="guide-chat-card">
        {context.length > 0 && (
          <div className="guide-chat-attachments" aria-label={t("chatContext")}>
            {context.map((item, index) => (
              <div className="guide-chat-attachment" key={index}>
                {item.kind === "image" ? (
                  // Context thumbnails are local data URLs, never optimized remote assets.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.dataUrl} alt="" />
                ) : (
                  <FileText size={14} aria-hidden="true" />
                )}
                <span title={item.kind === "image" ? item.name : item.text}>
                  {item.kind === "image" ? item.name : item.text}
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  aria-label={t("chatRemoveContext", {
                    name: item.kind === "image" ? item.name : t("chatTextContext"),
                  })}
                  onClick={() =>
                    setContext((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          className="guide-chat-input"
          value={prompt}
          rows={2}
          disabled={isBusy}
          aria-label={t("chatPlaceholder")}
          placeholder={t("chatPlaceholder")}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="guide-chat-bar">
          <GuideChatContext
            disabled={isBusy || context.length >= MAX_GUIDE_CONTEXT_ITEMS}
            onAdd={(item) => setContext((current) => [...current, item])}
            onProcessingChange={setIsProcessing}
          />
          <span className="guide-chat-context-folder-wrap" title={folderHint}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="guide-chat-context-folder"
              disabled={isBusy || !cli.state}
              onClick={async () => {
                setIsChoosingFolder(true);
                setHasFolderError(false);
                try {
                  await cli.chooseFolder();
                } catch {
                  setHasFolderError(true);
                } finally {
                  setIsChoosingFolder(false);
                }
              }}
              aria-describedby={contextFolderHintId}
            >
              <Folder aria-hidden="true" size={14} />
              <span>
                {contextFolder
                  ? contextFolder.split(/[\\/]/).filter(Boolean).at(-1)
                  : t("chatContextFolder")}
              </span>
            </Button>
            <span className="sr-only" id={contextFolderHintId}>
              {folderHint}
            </span>
          </span>
          {contextFolder && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={isBusy}
              aria-label={t("chatRemoveFolder")}
              title={t("chatRemoveFolder")}
              onClick={() => void cli.clearFolder()}
            >
              <X size={12} />
            </Button>
          )}
          <span className="guide-chat-spacer" aria-hidden="true" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={`guide-chat-audio${isListening ? " is-listening" : ""}`}
            title={
              supported ? t(isListening ? "chatStopAudio" : "chatAudio") : t("chatAudioUnsupported")
            }
            aria-label={
              supported ? t(isListening ? "chatStopAudio" : "chatAudio") : t("chatAudioUnsupported")
            }
            aria-pressed={isListening}
            disabled={isBusy || !supported}
            onClick={toggleDictation}
          >
            <Mic aria-hidden="true" size={15} />
          </Button>
          <Button
            type="button"
            size="icon"
            title={updating ? t("chatThinking") : t("chatSend")}
            aria-label={updating ? t("chatThinking") : t("chatSend")}
            disabled={isBusy || !prompt.trim()}
            onClick={() => void send()}
          >
            {updating ? (
              <LoaderCircle className="guide-chat-spinner" aria-hidden="true" size={15} />
            ) : (
              <Send aria-hidden="true" size={15} />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
