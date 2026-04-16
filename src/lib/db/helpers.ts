import { cache } from "react";
import { auth } from "@/lib/auth/auth";

import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";
import type { GroupConfig, RepoConfig, ActionResult, UserRole } from "@/lib/types";

/**
 * Get the authenticated session with userId and role. Cached per request via React cache().
 * Returns null if not authenticated.
 */
export const getAuthenticatedSession = cache(
  async (): Promise<{ userId: string; role: UserRole; email: string } | null> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return null;
    const role = (session.user.role === "admin" ? "admin" : "user") satisfies UserRole;
    return { userId: session.user.id, role, email: session.user.email };
  }
);

/**
 * Require admin role. Returns ActionResult with error if not admin.
 */
export async function requireAdmin(): Promise<ActionResult<{ userId: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }
  if (session.role !== "admin") {
    return { success: false, error: "Access denied", code: "FORBIDDEN" };
  }
  return { success: true, data: { userId: session.userId } };
}

/**
 * Get the authenticated user's ID. Cached per request via React cache().
 * Delegates to getAuthenticatedSession to avoid duplicate auth.api.getSession calls.
 */
export const getAuthenticatedUserId = cache(
  async (): Promise<string | null> => {
    const session = await getAuthenticatedSession();
    return session?.userId ?? null;
  }
);

/**
 * Get all repos for the authenticated user. Cached per request via React cache().
 * Deduplicates across layout.tsx and page.tsx within the same render.
 */
export const getAuthenticatedRepos = cache(
  async (userId: string): Promise<RepoConfig[]> => {
    const rows = await prisma.repo.findMany({
      where: { userId },
      select: {
        id: true,
        owner: true,
        name: true,
        fullPath: true,
        branch: true,
        displayName: true,
        description: true,
        sourceType: true,
        localPath: true,
        lastSyncedAt: true,
        groupId: true,
        role: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows as RepoConfig[];
  }
);

export const getAuthenticatedGroups = cache(
  async (userId: string): Promise<GroupConfig[]> => {
    const rows = await prisma.bmadGroup.findMany({
      where: { userId },
      select: {
        id: true,
        sourceType: true,
        gitlabGroupId: true,
        fullPath: true,
        name: true,
        displayName: true,
        description: true,
        lastSyncedAt: true,
        repos: {
          select: {
            id: true,
            owner: true,
            name: true,
            fullPath: true,
            branch: true,
            displayName: true,
            description: true,
            sourceType: true,
            localPath: true,
            lastSyncedAt: true,
            groupId: true,
            role: true,
          },
          orderBy: [{ role: "asc" }, { fullPath: "asc" }],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows as GroupConfig[];
  },
);

/**
 * Get a single repo config for the authenticated user. Cached per request.
 * Returns null if not found (user doesn't own this repo).
 */
export const getAuthenticatedRepoConfig = cache(
  async (
    userId: string,
    owner: string,
    name: string
  ): Promise<RepoConfig | null> => {
    const row = await prisma.repo.findFirst({
      where: { userId, owner, name },
      select: {
        id: true,
        owner: true,
        name: true,
        fullPath: true,
        branch: true,
        displayName: true,
        description: true,
        sourceType: true,
        localPath: true,
        lastSyncedAt: true,
        groupId: true,
        role: true,
      },
    });
    return row as RepoConfig | null;
  }
);

export const getAuthenticatedRepoConfigById = cache(
  async (userId: string, repoId: string): Promise<RepoConfig | null> => {
    const row = await prisma.repo.findFirst({
      where: { userId, id: repoId },
      select: {
        id: true,
        owner: true,
        name: true,
        fullPath: true,
        branch: true,
        displayName: true,
        description: true,
        sourceType: true,
        localPath: true,
        lastSyncedAt: true,
        groupId: true,
        role: true,
      },
    });
    return row as RepoConfig | null;
  }
);

export const getAuthenticatedGroupConfigById = cache(
  async (userId: string, groupId: string): Promise<GroupConfig | null> => {
    const row = await prisma.bmadGroup.findFirst({
      where: { userId, id: groupId },
      select: {
        id: true,
        sourceType: true,
        gitlabGroupId: true,
        fullPath: true,
        name: true,
        displayName: true,
        description: true,
        lastSyncedAt: true,
        repos: {
          select: {
            id: true,
            owner: true,
            name: true,
            fullPath: true,
            branch: true,
            displayName: true,
            description: true,
            sourceType: true,
            localPath: true,
            lastSyncedAt: true,
            groupId: true,
            role: true,
          },
          orderBy: [{ role: "asc" }, { fullPath: "asc" }],
        },
      },
    });
    return row as GroupConfig | null;
  },
);
