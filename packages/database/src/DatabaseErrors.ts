/** The database was created by a different schema lineage and cannot be migrated in place. */
export class DatabaseSchemaMismatchError extends Error {
  constructor(databasePath: string) {
    super(
      `The database at ${databasePath} was created by an incompatible pre-release schema. ` +
        "Nothing was changed. Back it up and recreate it with `npm run db:reset -- --confirm`.",
    );
    this.name = "DatabaseSchemaMismatchError";
  }
}

/** A requested row does not exist or belongs to another owner. */
export class RecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordNotFoundError";
  }
}
