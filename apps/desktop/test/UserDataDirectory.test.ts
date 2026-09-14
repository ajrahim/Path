import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { resolveUserDataDirectory } from "../src/storage/UserDataDirectory";

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
});
