import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { DatabaseSchemaMismatchError, openDatabase } from "../src";
import {
  createTestRecording,
  MIGRATIONS_FOLDER,
  openTestDatabase,
  temporaryDirectory,
} from "./TestDatabase";

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("database initialization", () => {
  it("migrates baseline documents without losing saves, drafts, images, or history", () => {
    const databasePath = join(temporaryDirectory(), "baseline.sqlite");
    const baseline = new BetterSqlite3(databasePath);
    const migration = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })[0]!;
    const markdown = "# Saved\n\n![Image](data:image/png;base64,AAAA)";

    baseline.exec(readFileSync(join(MIGRATIONS_FOLDER, "0000_baseline.sql"), "utf8"));
    baseline.exec(
      "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    );
    baseline
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(migration.hash, migration.folderMillis);
    baseline
      .prepare("INSERT INTO storage_roots VALUES (?, ?, ?)")
      .run("root", "local-root", "2026-10-01");
    baseline
      .prepare(
        "INSERT INTO recordings (id, storage_root_id, title, status, capture_mode, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "recording",
        "root",
        "Login",
        "ready",
        "display",
        "2026-10-01",
        "2026-10-01",
        "2026-10-01",
      );
    baseline
      .prepare(
        "INSERT INTO documents (id, recording_id, draft_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("document", "recording", 1, "2026-10-01", "2026-10-01");
    baseline
      .prepare(
        "INSERT INTO document_revisions (document_id, number, kind, content_hash, body, body_encoding, character_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "document",
        1,
        "saved",
        createHash("sha256").update(markdown).digest("hex"),
        markdown,
        "plain",
        markdown.length,
        "2026-10-01",
      );
    baseline
      .prepare("UPDATE documents SET saved_revision_number = 1, saved_at = ? WHERE id = ?")
      .run("2026-10-01", "document");
    baseline
      .prepare("INSERT INTO document_drafts VALUES (?, ?, ?)")
      .run("document", "# Unsaved", "2026-10-01");
    baseline
      .prepare("INSERT INTO document_images VALUES (?, ?, ?)")
      .run("document", "image-hash", "data:image/png;base64,AAAA");
    baseline.close();

    const migrated = openTestDatabase(databasePath);

    try {
      expect(migrated.documents.getCollection("recording")).toMatchObject({
        mode: "combine",
        documents: [{ id: "document", title: "Document" }],
      });
      expect(migrated.documents.getSnapshot("recording", "document")).toMatchObject({
        saved: { markdown },
        draft: { markdown: "# Unsaved" },
        draftVersion: 1,
        latestRevisionNumber: 1,
      });
      expect(migrated.documents.getRevision("recording", 1, "document").markdown).toBe(markdown);
      expect(
        migrated.connection.db.$client
          .prepare("SELECT count(*) AS count FROM document_images")
          .get(),
      ).toEqual({ count: 1 });
      expect(migrated.connection.db.$client.pragma("foreign_key_check")).toEqual([]);
    } finally {
      migrated.connection.close();
    }
  });

  it("creates the file, parent directories, and durable settings on first launch", () => {
    const databasePath = join(temporaryDirectory(), "nested", "profile", "database.sqlite");
    const database = openTestDatabase(databasePath);

    expect(existsSync(databasePath)).toBe(true);
    expect(database.connection.db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    // 2 is FULL: an acknowledged commit survives power loss, not only an app crash.
    expect(database.connection.db.$client.pragma("synchronous", { simple: true })).toBe(2);
    expect(database.connection.db.$client.pragma("foreign_keys", { simple: true })).toBe(1);

    database.connection.close();
  });

  it("reopens an initialized database without resetting its data", () => {
    const first = openTestDatabase();
    const recordingId = createTestRecording(first);

    first.appSettings.set("desktop-settings", { general: { minimizeToTray: false } });
    first.connection.close();

    const reopened = openTestDatabase(first.databasePath);

    expect(reopened.recordings.get(recordingId)?.title).toBe("Recorded walkthrough");
    expect(reopened.appSettings.get("desktop-settings")).toEqual({
      general: { minimizeToTray: false },
    });

    reopened.connection.close();
  });

  it("rejects a database from another schema lineage without changing it", () => {
    const databasePath = join(temporaryDirectory(), "database.sqlite");
    const foreign = new BetterSqlite3(databasePath);

    foreign.exec(`
      CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric);
      INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('pre-release-hash', 1);
      CREATE TABLE recordings (id text PRIMARY KEY);
    `);
    foreign.close();

    const before = fileHash(databasePath);

    expect(() => openDatabase(databasePath, MIGRATIONS_FOLDER)).toThrow(
      DatabaseSchemaMismatchError,
    );
    expect(fileHash(databasePath)).toBe(before);

    // The handle was closed: Windows would refuse to delete a file that is still open.
    rmSync(databasePath);
  });

  it("rejects tables that were not created by the migrator", () => {
    const databasePath = join(temporaryDirectory(), "database.sqlite");
    const foreign = new BetterSqlite3(databasePath);

    foreign.exec("CREATE TABLE notes (id integer PRIMARY KEY)");
    foreign.close();

    expect(() => openDatabase(databasePath, MIGRATIONS_FOLDER)).toThrow(
      DatabaseSchemaMismatchError,
    );
  });

  it("fails without modifying a corrupt file and releases its handle", () => {
    const databasePath = join(temporaryDirectory(), "database.sqlite");

    writeFileSync(databasePath, "not a sqlite database ".repeat(512));
    const before = fileHash(databasePath);

    expect(() => openDatabase(databasePath, MIGRATIONS_FOLDER)).toThrow();
    expect(fileHash(databasePath)).toBe(before);

    rmSync(databasePath);
  });

  it("fails when the migrations are missing and releases the handle", () => {
    const directory = temporaryDirectory();
    const emptyMigrations = join(directory, "migrations");

    mkdirSync(emptyMigrations);

    expect(() => openDatabase(join(directory, "database.sqlite"), emptyMigrations)).toThrow();

    rmSync(join(directory, "database.sqlite"), { force: true });
  });
});
