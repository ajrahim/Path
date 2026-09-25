import { mkdir } from "node:fs/promises";
import { isAbsolute, join, parse, resolve } from "node:path";

export function resolveUserDataDirectory(appDataDirectory: string, override?: string): string {
  if (override !== undefined) {
    const resolvedOverride = resolve(override);

    if (!isAbsolute(override) || resolvedOverride === parse(resolvedOverride).root) {
      throw new Error("PATH_APP_USER_DATA must be an absolute, non-root directory");
    }

    return resolvedOverride;
  }

  return join(appDataDirectory, "Path");
}

/** Where each kind of durable data lives inside the resolved user-data directory. */
export interface UserDataLayout {
  userDataDirectory: string;
  /** Structured data: recordings, activity, imports, documents, settings, and prompts. */
  databasePath: string;
  /** Default media root; users may choose another and earlier roots stay registered. */
  defaultRecordingsDirectory: string;
  /** Rotating main-process diagnostics, separate from user data. */
  logsDirectory: string;
  whisperModelsDirectory: string;
  /** safeStorage-encrypted provider keys; never stored in SQLite or settings JSON. */
  credentialsPath: string;
  cliWorkDirectory: string;
}

export function userDataLayout(userDataDirectory: string): UserDataLayout {
  return {
    userDataDirectory,
    databasePath: join(userDataDirectory, "database.sqlite"),
    defaultRecordingsDirectory: join(userDataDirectory, "recordings"),
    logsDirectory: join(userDataDirectory, "logs"),
    whisperModelsDirectory: join(userDataDirectory, "models", "whisper"),
    credentialsPath: join(userDataDirectory, "credentials", "ai-providers.json"),
    cliWorkDirectory: join(userDataDirectory, "cli-work"),
  };
}

/** First launch creates the directories; later launches find them and change nothing. */
export async function createUserDataDirectories(layout: UserDataLayout): Promise<void> {
  for (const directory of [
    layout.userDataDirectory,
    layout.logsDirectory,
    layout.whisperModelsDirectory,
    parse(layout.credentialsPath).dir,
    layout.cliWorkDirectory,
  ]) {
    await mkdir(directory, { recursive: true });
  }
}
