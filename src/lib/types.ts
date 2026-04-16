export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/** User roles managed by Better Auth as plain strings in Prisma. */
export type UserRole = "user" | "admin";

export function isUserRole(value: unknown): value is UserRole {
  return value === "user" || value === "admin";
}

/** Source type for a repo: remote provider. */
export type SourceType = "gitlab";

export type RepoRole = "general" | "member";

/** Shared repo config shape used across layout, pages, sidebar, and parser. */
export interface RepoConfig {
  id: string;
  owner: string;
  name: string;
  fullPath: string | null;
  branch: string;
  displayName: string;
  description: string | null;
  sourceType: SourceType;
  localPath: string | null;
  lastSyncedAt: Date | null;
  groupId: string | null;
  role: RepoRole;
}

export interface GroupConfig {
  id: string;
  sourceType: SourceType;
  gitlabGroupId: number;
  fullPath: string;
  name: string;
  displayName: string;
  description: string | null;
  lastSyncedAt: Date | null;
  repos: RepoConfig[];
}
