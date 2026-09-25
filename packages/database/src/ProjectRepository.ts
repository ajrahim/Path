import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  projectChangeInputSchema,
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
}
