// Moves a development profile's database aside so Path can create a fresh one.
//
//   npm run db:reset -- --confirm
//
// Nothing is deleted: database.sqlite and its WAL files move to backups/reset-<time>/ inside the
// profile. Recording media, logs, models, and credentials stay where they are. The profile is
// PATH_APP_USER_DATA when set, otherwise Electron's default location for Path.
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DATABASE_FILES = ["database.sqlite", "database.sqlite-wal", "database.sqlite-shm"];

function defaultAppDataDirectory() {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }

  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");

  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

function profileDirectory() {
  const override = process.env.PATH_APP_USER_DATA;

  if (override === undefined) return join(defaultAppDataDirectory(), "Path");
  if (!isAbsolute(override)) throw new Error("PATH_APP_USER_DATA must be an absolute directory");

  return resolve(override);
}

const profile = profileDirectory();
const present = DATABASE_FILES.filter((name) => existsSync(join(profile, name)));

if (present.length === 0) {
  console.log(`No database found in ${profile}. Nothing to reset.`);
  process.exit(0);
}

if (!process.argv.includes("--confirm")) {
  console.log(`This moves ${present.join(", ")} out of ${profile} into a backup folder.`);
  console.log("Close Path, then run: npm run db:reset -- --confirm");
  process.exit(1);
}

const backup = join(profile, "backups", `reset-${new Date().toISOString().replace(/[:.]/g, "-")}`);

mkdirSync(backup, { recursive: true });

try {
  // The main file moves first: while Path holds it open, Windows refuses and nothing moves.
  for (const name of present) renameSync(join(profile, name), join(backup, name));
} catch (error) {
  // Leave no empty backup folder behind when nothing could be moved.
  if (readdirSync(backup).length === 0) rmdirSync(backup);

  console.error(`Could not move the database. Close Path and try again. (${error.message})`);
  process.exit(1);
}

console.log(`Moved ${present.join(", ")} to ${backup}`);
console.log("Recording media in the profile was left in place and is no longer listed.");
