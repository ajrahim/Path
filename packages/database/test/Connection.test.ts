import { beforeEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/Connection";

const nativeDatabase = vi.hoisted(() => ({ pragma: vi.fn(), close: vi.fn() }));
const migrate = vi.hoisted(() => vi.fn());

vi.mock("better-sqlite3", () => ({
  default: class {
    pragma = nativeDatabase.pragma;
    close = nativeDatabase.close;
  },
}));
vi.mock("drizzle-orm/better-sqlite3", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/better-sqlite3/migrator", () => ({ migrate }));

beforeEach(() => vi.resetAllMocks());

it("closes the native handle and preserves the cause when migration fails", () => {
  const migrationError = new Error("Migration could not be applied");

  // Fail after the handle opens, where cleanup belongs to openDatabase rather than its caller.
  migrate.mockImplementation(() => {
    throw migrationError;
  });

  expect(() => openDatabase(":memory:", "migrations")).toThrow(migrationError);
  expect(nativeDatabase.close).toHaveBeenCalledExactlyOnceWith();
});
