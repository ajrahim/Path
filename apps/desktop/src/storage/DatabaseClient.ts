import { Worker } from "node:worker_threads";
import { REPOSITORY_CLASSES, type DatabaseRepositories, type RepositoryName } from "@path/database";
import {
  deserializeDatabaseError,
  type DatabaseRequest,
  type DatabaseWorkerMessage,
  type DatabaseWorkerOptions,
  type TimelineFileImportJob,
  type TimelineFileImportOutcome,
} from "./DatabaseWorkerProtocol";

/** A repository's public methods as the main process sees them: every call crosses a thread. */
type RemoteRepository<T> = {
  [Method in keyof T]: T[Method] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Promise<Awaited<Result>>
    : never;
};

export type RemoteRepositories = {
  [Name in RepositoryName]: RemoteRepository<DatabaseRepositories[Name]>;
};

/** The worker-side operation that is not a single repository call. */
export interface TimelineFileImporter {
  importTimelineFile(job: TimelineFileImportJob): Promise<TimelineFileImportOutcome>;
}

type InvokeRepository = (
  repository: RepositoryName,
  method: string,
  args: unknown[],
) => Promise<unknown>;

/** Builds typed stand-ins whose methods forward to `invoke`, one per repository method. */
export function createRemoteRepositories(invoke: InvokeRepository): RemoteRepositories {
  const repositories = Object.entries(REPOSITORY_CLASSES).map(([name, repositoryClass]) => {
    const methods = Object.getOwnPropertyNames(repositoryClass.prototype)
      .filter((method) => method !== "constructor")
      .map((method) => [
        method,
        (...args: unknown[]) => invoke(name as RepositoryName, method, args),
      ]);

    return [name, Object.fromEntries(methods)];
  });

  return Object.fromEntries(repositories) as RemoteRepositories;
}

/** Raised for every pending and later request once the worker has stopped. */
export class DatabaseUnavailableError extends Error {
  constructor(cause: string) {
    super(`The local database is unavailable: ${cause}`);
    this.name = "DatabaseUnavailableError";
  }
}

export interface DatabaseClientOptions extends DatabaseWorkerOptions {
  workerPath: string;
  /** Called once if the worker stops without being closed. */
  onUnexpectedExit?(error: DatabaseUnavailableError): void;
}

interface Settlement<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

type RequestWithoutId = DatabaseRequest extends infer Request
  ? Request extends DatabaseRequest
    ? Omit<Request, "id">
    : never
  : never;

/**
 * Main-process side of the database worker. Requests keep their send order; `open` resolves only
 * after migrations and startup recovery finish; `close` drains in-flight work before the
 * connection closes. The main thread never executes SQL.
 */
export class DatabaseClient implements TimelineFileImporter {
  readonly repositories: RemoteRepositories;
  private readonly pending = new Map<number, Settlement<unknown>>();
  private readonly startup: Promise<void>;
  private startupSettlement: Settlement<void> | null = null;
  private drainWaiters: (() => void)[] = [];
  private nextRequestId = 1;
  private unavailable: DatabaseUnavailableError | null = null;
  private isClosing = false;
  private hasExited = false;
  private closing: Promise<void> | null = null;

  private constructor(
    private readonly worker: Worker,
    private readonly onUnexpectedExit: (error: DatabaseUnavailableError) => void,
  ) {
    this.repositories = createRemoteRepositories((repository, method, args) =>
      this.send({ type: "call", repository, method, args }),
    );

    this.startup = new Promise((resolve, reject) => {
      this.startupSettlement = { resolve, reject };
    });

    // One set of listeners for the worker's lifetime covers startup and every response.
    worker.on("message", (message: DatabaseWorkerMessage) => this.receive(message));
    worker.on("error", (error) => this.stop(error.message));
    worker.on("exit", (code) => {
      this.hasExited = true;
      if (!this.isClosing || this.pending.size > 0) this.stop(`the worker exited (${code})`);
    });
  }

  /** Starts the worker and waits until the database is migrated and recovered. */
  static async open(options: DatabaseClientOptions): Promise<DatabaseClient> {
    const worker = new Worker(options.workerPath, {
      // The worker runs only its own bundle; parent flags such as preloads do not apply to it.
      execArgv: [],
      workerData: {
        databasePath: options.databasePath,
        migrationsFolder: options.migrationsFolder,
      } satisfies DatabaseWorkerOptions,
    });

    const client = new DatabaseClient(worker, options.onUnexpectedExit ?? (() => undefined));

    try {
      await client.startup;
    } catch (error) {
      await worker.terminate();

      throw error;
    }

    return client;
  }

  importTimelineFile(job: TimelineFileImportJob): Promise<TimelineFileImportOutcome> {
    return this.send({ type: "import-timeline-file", job }) as Promise<TimelineFileImportOutcome>;
  }

  /**
   * Stops accepting requests, waits for in-flight ones, then closes the connection. A worker that
   * does not finish within the timeout is terminated; SQLite discards any uncommitted
   * transaction, and an unfinished import is removed at the next startup.
   */
  close(timeoutMs: number): Promise<void> {
    this.isClosing = true;
    this.closing ??= this.drainAndClose(Date.now() + timeoutMs);

    return this.closing;
  }

  private async drainAndClose(deadline: number): Promise<void> {
    if (this.unavailable) return;

    const exited = new Promise<void>((resolve) => this.worker.once("exit", () => resolve()));

    try {
      await withDeadline(this.whenDrained(), deadline);
      await withDeadline(this.dispatch({ type: "close" }), deadline);
      // After acknowledging close the worker ends by itself; waiting avoids tearing down a thread
      // while its native SQLite module is still releasing resources.
      await withDeadline(exited, deadline);
    } finally {
      if (!this.hasExited) await this.worker.terminate();
    }
  }

  private send(request: RequestWithoutId): Promise<unknown> {
    if (this.unavailable) return Promise.reject(this.unavailable);
    if (this.isClosing) return Promise.reject(new DatabaseUnavailableError("the app is closing"));

    return this.dispatch(request);
  }

  private dispatch(request: RequestWithoutId): Promise<unknown> {
    const id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } as DatabaseRequest);
    });
  }

  private receive(message: DatabaseWorkerMessage): void {
    if (message.type === "ready") {
      this.startupSettlement?.resolve();
      this.startupSettlement = null;

      return;
    }

    if (message.type === "init-failed") {
      this.failStartup(deserializeDatabaseError(message.error));

      return;
    }

    const request = this.pending.get(message.id);

    if (!request) return;

    this.pending.delete(message.id);

    if (message.ok) request.resolve(message.value);
    else request.reject(deserializeDatabaseError(message.error));

    if (this.pending.size === 0) this.releaseDrainWaiters();
  }

  private whenDrained(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();

    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  private releaseDrainWaiters(): void {
    const waiters = this.drainWaiters;

    this.drainWaiters = [];
    for (const release of waiters) release();
  }

  private failStartup(error: Error): void {
    this.unavailable ??= new DatabaseUnavailableError(error.message);
    this.startupSettlement?.reject(error);
    this.startupSettlement = null;
  }

  private stop(cause: string): void {
    if (this.unavailable) return;

    this.unavailable = new DatabaseUnavailableError(cause);

    // A worker that stops before it is ready fails `open` instead of reporting a later crash.
    if (this.startupSettlement) {
      this.failStartup(this.unavailable);

      return;
    }

    for (const request of this.pending.values()) request.reject(this.unavailable);
    this.pending.clear();
    this.releaseDrainWaiters();

    if (!this.isClosing) this.onUnexpectedExit(this.unavailable);
  }
}

/** Resolves when the promise settles or the deadline passes, whichever comes first. */
async function withDeadline(promise: Promise<unknown>, deadline: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
  });

  try {
    await Promise.race([promise.then(() => undefined), expired]);
  } finally {
    clearTimeout(timer);
  }
}
