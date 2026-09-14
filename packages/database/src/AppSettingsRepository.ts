import { eq } from "drizzle-orm";
import type { PathDatabase } from "./Connection";
import { appSettings } from "./Schema";

/** Stores setting values by their stable keys; the owning settings service validates their shape. */
export class AppSettingsRepository {
  constructor(private readonly db: PathDatabase) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });

    return row ? (row.valueJson as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const updatedAt = new Date().toISOString();

    await this.db
      .insert(appSettings)
      .values({ key, valueJson: value, updatedAt })
      .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: value, updatedAt } });
  }
}
