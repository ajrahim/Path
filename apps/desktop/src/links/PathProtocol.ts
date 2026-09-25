import { resolve } from "node:path";
import { parsePathAppLink, type PathAppLink } from "./PathAppLink";

type OpenUrlListener = (event: { preventDefault(): void }, url: string) => void;
type SecondInstanceListener = (event: unknown, argv: string[]) => void;

interface PathProtocolApp {
  isPackaged: boolean;
  getAppPath(): string;
  setAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
  on(event: "open-url", listener: OpenUrlListener): unknown;
  on(event: "second-instance", listener: SecondInstanceListener): unknown;
  removeListener(event: "open-url", listener: OpenUrlListener): unknown;
  removeListener(event: "second-instance", listener: SecondInstanceListener): unknown;
}

interface PathProtocolHandlers {
  dispatch(link: PathAppLink): Promise<void> | void;
  onError(error: Error): Promise<void> | void;
  /** A lightweight status check must not wait behind media or AI work. */
  onStatus(): void;
  /** Focus an already initialized app immediately, even while an import is still queued. */
  onLaunch?(): void;
}

/** Owns external-link delivery; it does not own Electron's single-instance lock or windows. */
export class PathProtocol {
  private readonly app: PathProtocolApp;
  private readonly executablePath: string;
  private readonly pending: Array<PathAppLink | Error> = [];
  private handlers: PathProtocolHandlers | null = null;
  private draining: Promise<void> | null = null;
  private isStopped = false;

  constructor(options: { app: PathProtocolApp; argv: string[]; executablePath: string }) {
    this.app = options.app;
    this.executablePath = options.executablePath;

    // Install synchronously, before app.whenReady(): macOS may deliver a cold launch URL now.
    this.app.on("open-url", this.onOpenUrl);
    this.app.on("second-instance", this.onSecondInstance);
    this.acceptArguments(options.argv);
  }

  /** Call only in the primary instance after acquiring its single-instance lock. */
  register(): boolean {
    if (this.isStopped) return false;
    if (this.app.isPackaged) return this.app.setAsDefaultProtocolClient("pathai");

    return this.app.setAsDefaultProtocolClient("pathai", this.executablePath, [
      resolve(this.app.getAppPath()),
    ]);
  }

  /** Attach only after database, windows, and import services are ready. */
  attach(handlers: PathProtocolHandlers): void {
    if (this.handlers || this.isStopped) throw new Error("Path links cannot be attached now.");

    this.handlers = handlers;
    const queued = this.pending.splice(0);

    for (const item of queued) {
      if (!(item instanceof Error) && item.route === "status") this.reportStatus();
      else this.pending.push(item);
    }

    this.startDrain();
  }

  /** Stop receiving new commands and finish all accepted work before closing its dependencies. */
  async shutdown(): Promise<void> {
    this.isStopped = true;
    this.app.removeListener("open-url", this.onOpenUrl);
    this.app.removeListener("second-instance", this.onSecondInstance);

    // A secondary instance or failed startup has no services to dispatch into.
    if (!this.handlers) this.pending.length = 0;

    while (this.draining) await this.draining;
  }

  private readonly onOpenUrl: OpenUrlListener = (event, raw) => {
    if (this.isStopped || !/^pathai:/i.test(raw)) return;

    event.preventDefault();
    this.handlers?.onLaunch?.();
    this.acceptLink(raw);
  };

  private readonly onSecondInstance: SecondInstanceListener = (_event, argv) => {
    if (this.isStopped) return;

    this.handlers?.onLaunch?.();
    if (this.acceptArguments(argv)) return;

    this.pending.push({ route: "open" });
    this.startDrain();
  };

  private acceptArguments(argv: string[]): boolean {
    const links = argv.filter((argument) => /^pathai:/i.test(argument));

    for (const link of links) this.acceptLink(link);

    return links.length > 0;
  }

  private acceptLink(raw: string): void {
    if (this.isStopped) return;

    try {
      const link = parsePathAppLink(raw);

      if (link.route === "status" && this.handlers) this.reportStatus();
      else this.pending.push(link);
    } catch (error) {
      this.pending.push(error instanceof Error ? error : new Error("The Path link is invalid."));
    }

    this.startDrain();
  }

  private reportStatus(): void {
    try {
      this.handlers?.onStatus();
    } catch (error) {
      this.pending.push(
        error instanceof Error ? error : new Error("Path could not report its status."),
      );
    }
  }

  private startDrain(): void {
    if (!this.handlers || this.draining || this.pending.length === 0) return;

    this.draining = this.dispatchQueuedLinks().finally(() => {
      this.draining = null;
      this.startDrain();
    });
  }

  private async dispatchQueuedLinks(): Promise<void> {
    const handlers = this.handlers;

    if (!handlers) return;

    while (this.pending.length > 0) {
      const item = this.pending.shift();

      if (!item) continue;

      try {
        if (item instanceof Error) throw item;

        await handlers.dispatch(item);
      } catch (error) {
        try {
          await handlers.onError(
            error instanceof Error ? error : new Error("The Path link could not be completed."),
          );
        } catch {
          // A failed notification must not strand later commands or reject during shutdown.
        }
      }
    }
  }
}
