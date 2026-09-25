import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  projectChangeInputSchema,
  recordingIdInputSchema,
  type ProjectChangeInput,
  type RecordingProject,
} from "@path/shared";
import type { PathDatabase } from "./Connection";
import { projects, projectRecordings, recordings } from "./Schema";

/** Project membership is independent of recording content and managed media. */
export class ProjectRepository {
  constructor(private readonly db: PathDatabase) {}

  list(): RecordingProject[] {
    const rows = this.db
      .select()
      .from(projects)
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .all();

    const recordingIdsByProject = new Map<string, string[]>();

    for (const member of this.db.select().from(projectRecordings).all()) {
      const recordingIds = recordingIdsByProject.get(member.projectId) ?? [];

      recordingIds.push(member.recordingId);
      recordingIdsByProject.set(member.projectId, recordingIds);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      recordingIds: recordingIdsByProject.get(row.id) ?? [],
    }));
  }

  change(rawInput: ProjectChangeInput): RecordingProject[] {
    const input = projectChangeInputSchema.parse(rawInput);

    this.db.transaction((tx) => {
      if (input.action === "create") {
        tx.insert(projects)
          .values({ id: randomUUID(), name: input.name, createdAt: new Date().toISOString() })
          .run();

        return;
      }

      const projectId = input.action === "move" ? input.projectId : input.id;

      if (projectId && !tx.select().from(projects).where(eq(projects.id, projectId)).get()) {
        throw new Error("Project not found");
      }

      if (input.action === "rename") {
        tx.update(projects).set({ name: input.name }).where(eq(projects.id, input.id)).run();
      } else if (input.action === "remove") {
        // Membership cascades; recording rows and assets remain untouched.
        tx.delete(projects).where(eq(projects.id, input.id)).run();
      } else {
        if (
          !tx
            .select({ id: recordings.id })
            .from(recordings)
            .where(eq(recordings.id, input.recordingId))
            .get()
        ) {
          throw new Error("Recording not found");
        }

        if (input.projectId === null) {
          tx.delete(projectRecordings)
            .where(eq(projectRecordings.recordingId, input.recordingId))
            .run();
        } else {
          tx.insert(projectRecordings)
            .values({ recordingId: input.recordingId, projectId: input.projectId })
            .onConflictDoUpdate({
              target: projectRecordings.recordingId,
              set: { projectId: input.projectId },
            })
            .run();
        }
      }
    });

    return this.list();
  }

  /** Resolve the latest folder name and move membership in one database operation. */
  moveToNamedProject(recordingId: string, name: string): void {
    const { id } = recordingIdInputSchema.parse({ id: recordingId });
    const input = projectChangeInputSchema.options[0].parse({ action: "create", name });
    const requestedName = input.name.toLocaleLowerCase();

    this.db.transaction((tx) => {
      if (!tx.select({ id: recordings.id }).from(recordings).where(eq(recordings.id, id)).get()) {
        throw new Error("Recording not found");
      }

      const matches = tx
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .all()
        .filter((project) => project.name.toLocaleLowerCase() === requestedName);

      if (matches.length > 1) {
        throw new Error(`More than one folder is named "${input.name}". Rename one and try again.`);
      }

      const projectId = matches[0]?.id ?? randomUUID();

      if (matches.length === 0) {
        tx.insert(projects)
          .values({ id: projectId, name: input.name, createdAt: new Date().toISOString() })
          .run();
      }

      tx.insert(projectRecordings)
        .values({ recordingId: id, projectId })
        .onConflictDoUpdate({ target: projectRecordings.recordingId, set: { projectId } })
        .run();
    });
  }
}
