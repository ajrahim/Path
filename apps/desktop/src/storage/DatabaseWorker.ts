import { parentPort, workerData } from "node:worker_threads";
import {
  createRepositories,
  openDatabase,
  REPOSITORY_CLASSES,
  type DatabaseConnection,
  type DatabaseRepositories,
} from "@path/database";
import {
  serializeDatabaseError,
  type DatabaseRequest,
  type DatabaseWorkerMessage,
  type DatabaseWorkerOptions,
} from "./DatabaseWorkerProtocol";
import { runTimelineFileImport } from "./TimelineImportJob";

/**
 * Database worker thread entry. It owns the only SQLite connection, so all SQL runs off the
 * Electron main thread. Repository calls are synchronous and run one at a time in arrival
 * order; a transaction therefore never interleaves with another request. Streaming imports are
 * the only asynchronous work and commit in batches between other requests.
 */
const port = parentPort;

if (!port) throw new Error("The database worker must run in a worker thread");

const options = workerData as DatabaseWorkerOptions;
let connection: DatabaseConnection | null = null;
let repositories: DatabaseRepositories | null = null;

function post(message: DatabaseWorkerMessage): void {
  port?.postMessage(message);
}

function callRepository(
  active: DatabaseRepositories,
  request: Extract<DatabaseRequest, { type: "call" }>,
): unknown {
  const repositoryClass = REPOSITORY_CLASSES[request.repository];
  const isRepositoryMethod =
    request.method !== "constructor" &&
    Object.hasOwn(repositoryClass.prototype, request.method) &&
    typeof Reflect.get(repositoryClass.prototype, request.method) === "function";

  if (!isRepositoryMethod) {
    throw new Error(`Unknown database operation: ${request.repository}.${request.method}`);
  }

  const repository = active[request.repository];
  const method = Reflect.get(repository, request.method) as (...args: unknown[]) => unknown;

  return method.apply(repository, request.args);
}

async function handleRequest(request: DatabaseRequest): Promise<void> {
  try {
    if (!connection || !repositories) throw new Error("The database is closed");

    if (request.type === "close") {
      connection.close();
      connection = null;
      repositories = null;
      post({ type: "response", id: request.id, ok: true, value: null });
      // Closing the port lets the thread exit on its own; forced termination is only a fallback.
      port?.close();

      return;
    }

    const value =
      request.type === "call"
        ? callRepository(repositories, request)
        : await runTimelineFileImport(repositories, request.job);

    post({ type: "response", id: request.id, ok: true, value });
  } catch (error) {
    post({ type: "response", id: request.id, ok: false, error: serializeDatabaseError(error) });
  }
}

try {
  connection = openDatabase(options.databasePath, options.migrationsFolder);
  repositories = createRepositories(connection.db);

  // An import interrupted by a crash never became visible; its staging rows are dropped.
  const discardedStagingImports = repositories.timelineImports.discardAllStaging();

  post({ type: "ready", discardedStagingImports });
  port.on("message", (request: DatabaseRequest) => void handleRequest(request));
} catch (error) {
  connection?.close();
  post({ type: "init-failed", error: serializeDatabaseError(error) });
  port.close();
}
