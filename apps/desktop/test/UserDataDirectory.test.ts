import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import {
  createUserDataDirectories,
  resolveUserDataDirectory,
  userDataLayout,
} from "../src/storage/UserDataDirectory";

const directories: string[] = [];

function appDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "path-profile-test-"));

  directories.push(directory);

  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("user data directory", () => {
  it("uses Path for the installation directory", () => {
    const directory = appDataDirectory();

    expect(resolveUserDataDirectory(directory)).toBe(join(directory, "Path"));
  });

  it("lets native tests select an isolated profile", () => {
    const directory = appDataDirectory();
    const isolated = join(directory, "test-profile");

    expect(resolveUserDataDirectory(directory, isolated)).toBe(isolated);
  });

  it("rejects ambiguous and filesystem-root overrides", () => {
    const directory = appDataDirectory();

    for (const override of ["", "relative-profile", "/", parse(directory).root]) {
      expect(() => resolveUserDataDirectory(directory, override)).toThrow(
        "absolute, non-root directory",
      );
    }
  });

  it("creates every data directory on first launch and leaves existing data on reopen", async () => {
    const layout = userDataLayout(join(appDataDirectory(), "Path"));

    await createUserDataDirectories(layout);

    for (const directory of [
      layout.userDataDirectory,
      layout.logsDirectory,
      layout.whisperModelsDirectory,
      layout.cliWorkDirectory,
    ]) {
      expect(existsSync(directory)).toBe(true);
    }

    // The database and credentials are created by their owners, inside this layout.
    expect(layout.databasePath).toBe(join(layout.userDataDirectory, "database.sqlite"));
    expect(layout.credentialsPath).toBe(
      join(layout.userDataDirectory, "credentials", "ai-providers.json"),
    );

    writeFileSync(layout.databasePath, "existing data");
    await createUserDataDirectories(layout);

    expect(readFileSync(layout.databasePath, "utf8")).toBe("existing data");
  });
});
