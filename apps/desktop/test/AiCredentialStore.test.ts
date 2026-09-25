import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiCredentialStore } from "../src/storage/AiCredentialStore";

const storage = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (path: string) => {
    const content = storage.files.get(path);

    if (content === undefined) throw Object.assign(new Error("Missing file"), { code: "ENOENT" });

    return content;
  }),
  writeFile: storage.writeFile,
  rename: vi.fn(async (source: string, destination: string) => {
    const content = storage.files.get(source);

    if (content === undefined) throw Object.assign(new Error("Missing file"), { code: "ENOENT" });

    storage.files.set(destination, content);
    storage.files.delete(source);
  }),
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ""),
  },
}));

beforeEach(() => {
  storage.files.clear();
  storage.writeFile.mockReset();
  storage.writeFile.mockImplementation(async (path: string, content: string) => {
    storage.files.set(path, content);
  });
});

describe("AiCredentialStore", () => {
  it("preserves both providers when keys are saved concurrently", async () => {
    const store = new AiCredentialStore("credentials.json");

    await Promise.all([
      store.set("openai", "test-openai-key"),
      store.set("anthropic", "test-anthropic-key"),
    ]);

    expect(await store.get("openai")).toBe("test-openai-key");
    expect(await store.get("anthropic")).toBe("test-anthropic-key");
    expect(await store.getStatus()).toMatchObject({ openai: true, anthropic: true });
  });

  it("does not restore a removed key when another provider is saved concurrently", async () => {
    const store = new AiCredentialStore("credentials.json");

    await store.set("openai", "test-openai-key");
    await Promise.all([store.remove("openai"), store.set("anthropic", "test-anthropic-key")]);

    expect(await store.get("openai")).toBeNull();
    expect(await store.get("anthropic")).toBe("test-anthropic-key");
  });

  it("keeps committed keys and allows queued writes after a failed save", async () => {
    const store = new AiCredentialStore("credentials.json");

    await store.set("openai", "original-key");
    storage.writeFile.mockRejectedValueOnce(new Error("Disk unavailable"));

    const failedSave = store.set("openai", "replacement-key");
    const laterSave = store.set("anthropic", "test-anthropic-key");

    await expect(failedSave).rejects.toThrow("Disk unavailable");
    await laterSave;

    expect(await store.get("openai")).toBe("original-key");
    expect(await store.get("anthropic")).toBe("test-anthropic-key");
  });
});
