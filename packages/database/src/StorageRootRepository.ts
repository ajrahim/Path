import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { PathDatabase } from "./Connection";
import { storageRoots } from "./Schema";

export interface StorageRoot {
  id: string;
  path: string;
}

/** Registered recording directories; a root stays registered while any recording may use it. */
export class StorageRootRepository {
  constructor(private readonly db: PathDatabase) {}

  list(): StorageRoot[] {
    return this.db
      .select({ id: storageRoots.id, path: storageRoots.path })
      .from(storageRoots)
      .orderBy(asc(storageRoots.createdAt))
      .all();
  }

  /** Returns the existing root for a normalized path, or registers it. */
  register(path: string): StorageRoot {
    return this.db.transaction((tx) => {
      const existing = tx
        .select({ id: storageRoots.id, path: storageRoots.path })
        .from(storageRoots)
        .where(eq(storageRoots.path, path))
        .get();

      if (existing) return existing;

      const root = { id: randomUUID(), path };

      tx.insert(storageRoots)
        .values({ ...root, createdAt: new Date().toISOString() })
        .run();

      return root;
    });
  }
}
