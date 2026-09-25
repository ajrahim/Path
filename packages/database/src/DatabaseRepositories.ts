import { AppSettingsRepository } from "./AppSettingsRepository";
import { AssetDeletionRepository } from "./AssetDeletionRepository";
import type { PathDatabase } from "./Connection";
import { DocumentRepository } from "./DocumentRepository";
import { ProjectRepository } from "./ProjectRepository";
import { RecordingRepository } from "./RecordingRepository";
import { StorageRootRepository } from "./StorageRootRepository";
import { TimelineImportRepository } from "./TimelineImportRepository";

/** Every repository class by the name the desktop database worker exposes it under. */
export const REPOSITORY_CLASSES = {
  appSettings: AppSettingsRepository,
  assetDeletions: AssetDeletionRepository,
  documents: DocumentRepository,
  projects: ProjectRepository,
  recordings: RecordingRepository,
  storageRoots: StorageRootRepository,
  timelineImports: TimelineImportRepository,
} as const;

export type RepositoryName = keyof typeof REPOSITORY_CLASSES;

export type DatabaseRepositories = {
  [Name in RepositoryName]: InstanceType<(typeof REPOSITORY_CLASSES)[Name]>;
};

export function createRepositories(db: PathDatabase): DatabaseRepositories {
  return {
    appSettings: new AppSettingsRepository(db),
    assetDeletions: new AssetDeletionRepository(db),
    documents: new DocumentRepository(db),
    projects: new ProjectRepository(db),
    recordings: new RecordingRepository(db),
    storageRoots: new StorageRootRepository(db),
    timelineImports: new TimelineImportRepository(db),
  };
}
