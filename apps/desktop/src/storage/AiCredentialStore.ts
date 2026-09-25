import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import { aiProviders, type AiProvider, type AiProviderKeyStatus } from "@path/shared";

type EncryptedCredentials = Partial<Record<AiProvider, string>>;

// Plaintext keys stay in main-process memory; persisted values use Electron's encrypted storage.
export class AiCredentialStore {
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async getStatus(): Promise<AiProviderKeyStatus> {
    const credentials = await this.read();

    // Renderer callers need presence flags, never decrypted key material.
    return Object.fromEntries(
      aiProviders.map((provider) => [provider, Boolean(credentials[provider])]),
    ) as AiProviderKeyStatus;
  }

  async set(provider: AiProvider, key: string): Promise<AiProviderKeyStatus> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable");
    }

    return this.updateCredentials((credentials) => {
      credentials[provider] = safeStorage.encryptString(key).toString("base64");
    });
  }

  async get(provider: AiProvider): Promise<string | null> {
    const encrypted = (await this.read())[provider];

    if (!encrypted) return null;

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable");
    }

    try {
      return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch {
      throw new Error(`The stored ${provider} API key could not be decrypted`);
    }
  }

  remove(provider: AiProvider): Promise<AiProviderKeyStatus> {
    return this.updateCredentials((credentials) => {
      delete credentials[provider];
    });
  }

  private updateCredentials(
    change: (credentials: EncryptedCredentials) => void,
  ): Promise<AiProviderKeyStatus> {
    // Serialize the entire read-modify-write, including use of the shared temporary file.
    const result = this.mutation.then(async () => {
      const credentials = await this.read();

      change(credentials);
      await this.write(credentials);

      return this.getStatus();
    });

    // A failed write must not prevent later credential changes.
    this.mutation = result.catch(() => undefined);

    return result;
  }

  private async read(): Promise<EncryptedCredentials> {
    let content: string;

    try {
      content = await readFile(this.path, "utf8");
    } catch (error) {
      // Only a missing store is empty; corruption and permission errors must remain visible.
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return {};
      }

      throw error;
    }

    const value: unknown = JSON.parse(content);

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid AI credential store");
    }

    const credentials: EncryptedCredentials = {};

    for (const provider of aiProviders) {
      const encrypted = (value as Record<string, unknown>)[provider];

      if (encrypted !== undefined && typeof encrypted !== "string") {
        throw new Error(`Invalid ${provider} credential`);
      }

      if (encrypted) credentials[provider] = encrypted;
    }

    return credentials;
  }

  private async write(credentials: EncryptedCredentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });

    // Replace the last complete store only after the encrypted temporary file has been written.
    const temporaryPath = `${this.path}.tmp`;

    await writeFile(temporaryPath, JSON.stringify(credentials), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.path);
  }
}
