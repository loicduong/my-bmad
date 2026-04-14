"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { repoTag } from "@/lib/cache-tags";
import {
  getCachedGitLabRawContent,
  getCachedGitLabRepoTree,
  getGitLabBranches,
  getGitLabRepoTree,
  listGitLabProjects,
} from "@/lib/gitlab/client";
import { getGitLabToken } from "@/lib/gitlab/token";
import { buildFileTree } from "@/lib/bmad/utils";
import { parseBmadFile } from "@/lib/bmad/parser";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { z } from "zod";
import type { FileTreeNode, ParsedBmadFile } from "@/lib/bmad/types";
import type { ActionResult } from "@/lib/types";
import { sanitizeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import type { GitLabRepo } from "@/lib/gitlab/client";

const BMAD_OUTPUT = "_bmad-output";
const BMAD_CORE = "_bmad";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function requireAuthenticated(): Promise<ActionResult<{ userId: string }>> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }
  return { success: true, data: { userId: session.userId } };
}

async function getAuthenticatedGitLabToken(): Promise<
  ActionResult<{ token: string; userId: string }>
> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const token = await getGitLabToken(session.userId);
  if (!token) {
    return {
      success: false,
      error: "GitLab token not found. Please ensure GITLAB_PAT is set or you are logged in via GitLab.",
      code: "TOKEN_MISSING",
    };
  }

  return { success: true, data: { token, userId: session.userId } };
}

const repoIdentitySchema = z.union([
  z.object({ repoId: z.string().min(1).trim() }),
  z.object({
    owner: z.string().min(1).max(255).trim(),
    name: z.string().min(1).max(255).trim(),
  }),
]);

type RepoIdentityInput =
  | { repoId: string }
  | { owner: string; name: string };

async function findUserRepo(userId: string, input: RepoIdentityInput) {
  return prisma.repo.findFirst({
    where:
      "repoId" in input
        ? { userId, id: input.repoId }
        : { userId, owner: input.owner, name: input.name },
    select: {
      id: true,
      owner: true,
      name: true,
      branch: true,
      sourceType: true,
    },
  });
}

// ---------------------------------------------------------------------------
// GitLab actions
// ---------------------------------------------------------------------------

export async function listGitLabRepos(): Promise<ActionResult<GitLabRepo[]>> {
  const authResult = await getAuthenticatedGitLabToken();
  if (!authResult.success) return authResult;

  const { token, userId } = authResult.data;

  if (!checkRateLimit(`list-gitlab:${userId}`, 30, 60000)) {
    return { success: false, error: "Too many requests", code: "RATE_LIMIT" };
  }

  try {
    return { success: true, data: await listGitLabProjects(token) };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "GITLAB_ERROR"), code: "GITLAB_ERROR" };
  }
}

export async function detectGitLabBmadRepos(
  projectIds: { fullName: string; owner: string; name: string; defaultBranch: string }[],
): Promise<ActionResult<Record<string, boolean>>> {
  const authResult = await getAuthenticatedGitLabToken();
  if (!authResult.success) return authResult;

  const { token } = authResult.data;
  const results: Record<string, boolean> = {};

  for (const project of projectIds) {
    try {
      const tree = await getGitLabRepoTree(token, project.owner, project.name, project.defaultBranch);
      results[project.fullName] = tree.some(
        (item) =>
          item.type === "tree" &&
          !item.path.includes("/") &&
          (item.path === BMAD_CORE || item.path === BMAD_OUTPUT),
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[detectGitLabBmadRepos] ${project.fullName} failed: ${msg}`);
      results[project.fullName] = false;
    }
  }

  return { success: true, data: results };
}

const importRepoSchema = z.object({
  owner: z.string().min(1).max(255).trim(),
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(1000).nullable(),
  defaultBranch: z.string().min(1).max(255).trim(),
  fullName: z.string().min(1).max(512).trim(),
});

export async function importGitLabRepo(input: {
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  fullName: string;
}): Promise<
  ActionResult<{ id: string; owner: string; name: string; displayName: string }>
> {
  const parsed = importRepoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid data: " + parsed.error.issues[0].message,
      code: "VALIDATION_ERROR",
    };
  }
  const data = parsed.data;

  const authResult = await getAuthenticatedGitLabToken();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  if (!checkRateLimit(`import-gitlab:${userId}`, 10, 60000)) {
    return { success: false, error: "Too many requests", code: "RATE_LIMIT" };
  }

  try {
    const repo = await prisma.repo.create({
      data: {
        owner: data.owner,
        name: data.name,
        branch: data.defaultBranch,
        displayName: data.name,
        description: data.description,
        sourceType: "gitlab",
        lastSyncedAt: new Date(),
        userId,
      },
      select: { id: true, owner: true, name: true, displayName: true },
    });

    revalidatePath("/(dashboard)");
    return { success: true, data: repo };
  } catch (error: unknown) {
    if (
      error instanceof PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        success: false,
        error: "This repository is already imported.",
        code: "DUPLICATE",
      };
    }
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Common actions
// ---------------------------------------------------------------------------

export async function deleteRepo(
  input: RepoIdentityInput,
): Promise<ActionResult<{ deleted: boolean }>> {
  const parsed = repoIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  try {
    const deleted = await prisma.repo.deleteMany({
      where:
        "repoId" in parsed.data
          ? { userId, id: parsed.data.repoId }
          : { userId, owner: parsed.data.owner, name: parsed.data.name },
    });

    if (deleted.count === 0) {
      return { success: false, error: "Project not found", code: "NOT_FOUND" };
    }

    revalidatePath("/(dashboard)");
    return { success: true, data: { deleted: true } };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}

export async function refreshRepoData(
  input: RepoIdentityInput,
): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  const parsed = repoIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  try {
    const repoConfig = await findUserRepo(userId, parsed.data);

    if (!repoConfig) {
      return { success: false, error: "Project not found", code: "NOT_FOUND" };
    }

    // Since we only support GitLab now, we call the remote refresh directly
    return refreshGitLabRepo(repoConfig, userId);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "Rate limit reached. Cached data is displayed.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

async function refreshGitLabRepo(
  repoConfig: { id: string; owner: string; name: string; branch: string; sourceType: string },
  userId: string,
): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  revalidateTag(repoTag("gitlab", `${repoConfig.owner}/${repoConfig.name}`), "default");

  const syncBranch = repoConfig.branch;
  const token = await getGitLabToken(userId);
  if (!token) {
    return { success: false, error: "GitLab token not found.", code: "TOKEN_MISSING" };
  }
  
  const tree = await getGitLabRepoTree(token, repoConfig.owner, repoConfig.name, syncBranch);
  const totalFiles = tree.filter(
    (item) => item.type === "blob" && item.path?.startsWith("_bmad-output/")
  ).length;

  const now = new Date();
  await prisma.repo.update({
    where: { id: repoConfig.id },
    data: { lastSyncedAt: now, totalFiles },
  });

  revalidatePath("/(dashboard)");
  return { success: true, data: { totalFiles, lastSyncedAt: now.toISOString() } };
}

export async function fetchBmadFiles(input: RepoIdentityInput): Promise<
  ActionResult<{
    fileTree: FileTreeNode[];
    docsTree: FileTreeNode[];
    bmadCoreTree: FileTreeNode[];
    bmadFiles: string[];
  }>
> {
  const parsed = repoIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  const repoConfig = await findUserRepo(userId, parsed.data);
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }

  try {
    const token = await getGitLabToken(userId);
    if (!token) {
      throw Object.assign(new Error("GitLab token not found."), {
        code: "TOKEN_MISSING",
      });
    }
    const tree = await getCachedGitLabRepoTree(
      token,
      userId,
      repoConfig.owner,
      repoConfig.name,
      repoConfig.branch,
    );

    const allPaths = tree
      .filter((item) => item.type === "blob")
      .map((item) => item.path);

    const bmadPaths = allPaths.filter((p) => p.startsWith(BMAD_OUTPUT + "/"));
    const fileTree = buildFileTree(bmadPaths, BMAD_OUTPUT);

    const bmadCorePaths = allPaths.filter((p) => p.startsWith(BMAD_CORE + "/"));
    const bmadCoreTree = buildFileTree(bmadCorePaths, BMAD_CORE);

    const docsFolder = tree.find(
      (item) =>
        item.type === "tree" &&
        !item.path.includes("/") &&
        item.path.toLowerCase() === "docs",
    );
    const docsFolderName = docsFolder?.path ?? null;
    const docsTree = docsFolderName
      ? buildFileTree(
          allPaths.filter((p) => p.startsWith(docsFolderName + "/")),
          docsFolderName,
        )
      : [];

    return { success: true as const, data: { fileTree, docsTree, bmadCoreTree, bmadFiles: bmadPaths } };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "Rate limit reached. Cached data is displayed.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

const fetchFileContentSchema = z.object({
  repoId: z.string().min(1).trim().optional(),
  owner: z.string().min(1).max(255).trim().optional(),
  name: z.string().min(1).max(255).trim().optional(),
  path: z
    .string()
    .min(1)
    .max(1024)
    .trim()
    .refine((p) => !p.includes(".."), { message: "Invalid path" }),
}).refine((data) => !!data.repoId || (!!data.owner && !!data.name), {
  message: "repoId or owner/name is required",
});

export async function fetchFileContent(input: {
  repoId?: string;
  owner?: string;
  name?: string;
  path: string;
}): Promise<
  ActionResult<{
    content: string;
    contentType: "markdown" | "yaml" | "json" | "text";
  }>
> {
  const parsed = fetchFileContentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid data: " + parsed.error.issues[0].message,
      code: "VALIDATION_ERROR",
    };
  }

  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  const repoConfig = await findUserRepo(
    userId,
    parsed.data.repoId
      ? { repoId: parsed.data.repoId }
      : { owner: parsed.data.owner!, name: parsed.data.name! },
  );
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }

  const ext = parsed.data.path.split(".").pop()?.toLowerCase() ?? "";
  let contentType: "markdown" | "yaml" | "json" | "text" = "text";
  if (ext === "md") contentType = "markdown";
  else if (ext === "yaml" || ext === "yml") contentType = "yaml";
  else if (ext === "json") contentType = "json";

  try {
    const token = await getGitLabToken(userId);
    if (!token) {
      return { success: false, error: "GitLab token not found.", code: "TOKEN_MISSING" };
    }
    const content = await getCachedGitLabRawContent(
      token,
      userId,
      repoConfig.owner,
      repoConfig.name,
      repoConfig.branch,
      parsed.data.path,
    );

    return { success: true, data: { content, contentType } };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error
    ) {
      const status = (error as { status: number }).status;
      if (status === 403) {
        return { success: false, error: "Rate limit reached.", code: "RATE_LIMITED" };
      }
      if (status === 404) {
        return { success: false, error: "File not found.", code: "NOT_FOUND" };
      }
    }
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

export async function fetchParsedFileContent(input: {
  repoId?: string;
  owner?: string;
  name?: string;
  path: string;
}): Promise<ActionResult<ParsedBmadFile>> {
  const result = await fetchFileContent(input);
  if (!result.success) return result;

  const parsed = parseBmadFile(result.data.content, result.data.contentType);
  return { success: true, data: parsed };
}

export async function listRepoBranches(
  input: RepoIdentityInput,
): Promise<ActionResult<string[]>> {
  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;

  const { userId } = authResult.data;
  const parsed = repoIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION" };
  }

  const repoConfig = await findUserRepo(userId, parsed.data);
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }

  try {
    const token = await getGitLabToken(userId);
    if (!token) {
      return { success: false, error: "GitLab token not found.", code: "TOKEN_MISSING" };
    }
    return { success: true, data: await getGitLabBranches(token, repoConfig.owner, repoConfig.name) };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

export async function updateRepoBranch(input: {
  repoId?: string;
  owner?: string;
  name?: string;
  branch: string;
}): Promise<ActionResult<{ branch: string }>> {
  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;

  const { userId } = authResult.data;
  const parsed = z
    .union([
      z.object({ repoId: z.string().min(1), branch: z.string().min(1) }),
      z.object({ owner: z.string(), name: z.string(), branch: z.string().min(1) }),
    ])
    .safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", code: "VALIDATION" };
  }

  const repoConfig = await findUserRepo(userId, parsed.data);
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }

  try {
    await prisma.repo.update({
      where: { id: repoConfig.id },
      data: { branch: parsed.data.branch },
    });

    revalidateTag(repoTag("gitlab", `${repoConfig.owner}/${repoConfig.name}`), "default");
    revalidatePath("/(dashboard)");

    return { success: true, data: { branch: parsed.data.branch } };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}
