import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { DatabaseSchemaMismatchError } from "./DatabaseErrors";
import * as schema from "./Schema";

export type PathDatabase = ReturnType<typeof drizzle<typeof schema>>;

/** Drizzle's default bookkeeping table for applied migrations. */
const MIGRATIONS_TABLE = "__drizzle_migrations";

// Lets a short external lock, such as a backup tool, finish instead of failing immediately.
const BUSY_TIMEOUT_MS = 5_000;

/** The caller owns the native connection and must close it when the desktop shuts down. */
export interface DatabaseConnection {
  db: PathDatabase;
  close(): void;
}

/**
 * Open storage only after its versioned migrations have been applied. An existing file is never
 * reset: a database from another schema lineage is rejected before any statement changes it.
 */
export function openDatabase(databasePath: string, migrationsFolder: string): DatabaseConnection {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new BetterSqlite3(databasePath);

  try {
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

    // Inspect before any pragma that writes: enabling WAL rewrites the file header.
    assertKnownSchemaLineage(sqlite, databasePath, migrationsFolder);

    // WAL keeps readers consistent during writes; FULL makes each acknowledged commit durable.
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = FULL");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, { schema });

    migrate(db, { migrationsFolder });

    return { db, close: () => sqlite.close() };
  } catch (error) {
    // A failed open must not leave the native database handle open.
    sqlite.close();

    throw error;
  }
}

/** Every applied migration must still exist in the shipped folder; unknown history is foreign. */
function assertKnownSchemaLineage(
  sqlite: BetterSqlite3.Database,
  databasePath: string,
  migrationsFolder: string,
): void {
  const knownHashes = new Set(readMigrationFiles({ migrationsFolder }).map((entry) => entry.hash));
  const hasMigrationTable = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);

  if (!hasMigrationTable) {
    const userTable = sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get();

    // Tables without migration history were not created by Path's migrator.
    if (userTable) throw new DatabaseSchemaMismatchError(databasePath);

    return;
  }

  const applied = sqlite.prepare(`SELECT hash FROM ${MIGRATIONS_TABLE}`).all() as {
    hash: string;
  }[];

  if (applied.some((migration) => !knownHashes.has(migration.hash))) {
    throw new DatabaseSchemaMismatchError(databasePath);
  }
}
