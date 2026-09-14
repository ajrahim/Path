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
