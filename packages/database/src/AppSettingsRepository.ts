import { eq } from "drizzle-orm";
import type { PathDatabase } from "./Connection";
import { appSettings } from "./Schema";

/** Stores setting values by their stable keys; the owning settings service validates their shape. */
export class AppSettingsRepository {
  constructor(private readonly db: PathDatabase) {}

  get(key: string): unknown {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get();

    return row ? row.valueJson : null;
  }

  set(key: string, value: unknown): void {
    const updatedAt = new Date().toISOString();

    this.db
      .insert(appSettings)
      .values({ key, valueJson: value, updatedAt })
      .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: value, updatedAt } })
      .run();
  }
}
