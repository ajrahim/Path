import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./Schema";

export type PathDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** The caller owns the native connection and must close it when the desktop shuts down. */
export interface DatabaseConnection {
  db: PathDatabase;
  close(): void;
}

/** Open storage only after its versioned migrations have been applied successfully. */
export function openDatabase(databasePath: string, migrationsFolder: string): DatabaseConnection {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new BetterSqlite3(databasePath);

  try {
    // Foreign keys protect child metadata; WAL supports concurrent readers during recording writes.
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");

    const db = drizzle(sqlite, { schema });

    migrate(db, { migrationsFolder });

    return { db, close: () => sqlite.close() };
  } catch (error) {
    // A failed migration must not leave the native database handle open.
    sqlite.close();

    throw error;
  }
}
