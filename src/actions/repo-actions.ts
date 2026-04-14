"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { repoTag } from "@/lib/github/cache-tags";
import {
  createUserOctokit,
  getGitHubToken,
  getCachedUserRepoTree,
  getCachedUserRawContent,
} from "@/lib/github/client";
import {
  getCachedGitLabRawContent,
  getCachedGitLabRepoTree,
  getGitLabBranches,
  getGitLabRepoTree,
  listGitLabProjects,
} from "@/lib/gitlab/client";
import { getGitLabToken } from "@/lib/gitlab/token";
import { LocalProvider } from "@/lib/content-provider/local-provider";
import { buildFileTree } from "@/lib/bmad/utils";
import { parseBmadFile } from "@/lib/bmad/parser";
import { prisma } from "@/lib/db/client";
import { getAuthenticatedSession } from "@/lib/db/helpers";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { z } from "zod";
import { createHash } from "node:crypto";
import path from "node:path";
import type { GitHubRepo } from "@/lib/github/types";
import type { GitLabRepo } from "@/lib/gitlab/client";
import type { FileTreeNode, ParsedBmadFile } from "@/lib/bmad/types";
import type { ActionResult } from "@/lib/types";
import { sanitizeError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";

// GraphQL can handle ~30 repos per query safely (GitHub complexity limits)
const GRAPHQL_BATCH_SIZE = 30;

const BMAD_OUTPUT = "_bmad-output";
const BMAD_CORE = "_bmad";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Validate session and retrieve an authenticated Octokit instance.
 * For GitHub-only actions.
 */
async function getAuthenticatedOctokit(): Promise<
  ActionResult<{ octokit: ReturnType<typeof createUserOctokit>; userId: string }>
> {
  const session = await getAuthenticatedSession();
  if (!session) {
    return { success: false, error: "Not authenticated", code: "UNAUTHORIZED" };
  }

  const token = await getGitHubToken(session.userId);
  if (!token) {
    return {
      success: false,
      error: "GitHub OAuth token not found. Please reconnect.",
      code: "TOKEN_MISSING",
    };
  }

  return {
    success: true,
    data: { octokit: createUserOctokit(token), userId: session.userId },
  };
}

/**
 * Get authenticated user ID only (no GitHub token required).
 * For actions that work with both GitHub and local repos.
 */
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
      error: "GitLab OAuth token not found. Please reconnect.",
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
      localPath: true,
    },
  });
}

// ---------------------------------------------------------------------------
// GitHub-only actions
// ---------------------------------------------------------------------------

/**
 * Phase 1: List repos (fast — no BMAD detection).
 */
export async function listUserRepos(): Promise<ActionResult<GitHubRepo[]>> {
  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { octokit, userId } = authResult.data;

  if (!checkRateLimit(`list:${userId}`, 30, 60000)) {
    return { success: false, error: "Trop de requêtes", code: "RATE_LIMIT" };
  }

  try {
    const repos = await octokit.paginate(
      octokit.rest.repos.listForAuthenticatedUser,
      { per_page: 100, sort: "updated" }
    );

    const mapped: GitHubRepo[] = repos.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      description: r.description ?? null,
      isPrivate: r.private,
      updatedAt: r.updated_at ?? "",
      defaultBranch: r.default_branch ?? "main",
      hasBmad: false,
    }));

    return { success: true, data: mapped };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "GitHub rate limit reached. Try again in a few minutes.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "GITHUB_ERROR"), code: "GITHUB_ERROR" };
  }
}

/**
 * Phase 2: Detect BMAD via GraphQL (batch — ~30 repos per query).
 */
export async function detectBmadRepos(
  repoIds: { fullName: string; owner: string; name: string }[]
): Promise<ActionResult<Record<string, boolean>>> {
  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { octokit } = authResult.data;
  const results: Record<string, boolean> = {};

  for (let i = 0; i < repoIds.length; i += GRAPHQL_BATCH_SIZE) {
    const chunk = repoIds.slice(i, i + GRAPHQL_BATCH_SIZE);

    const variables: Record<string, string> = {};
    const repoFragments = chunk.map((repo, idx) => {
      const alias = `repo_${idx}`;
      const ownerVar = `$owner_${idx}`;
      const nameVar = `$name_${idx}`;
      variables[`owner_${idx}`] = repo.owner;
      variables[`name_${idx}`] = repo.name;
      return `${alias}: repository(owner: ${ownerVar}, name: ${nameVar}) {
      bmad: object(expression: "HEAD:_bmad") { __typename }
      bmadOutput: object(expression: "HEAD:_bmad-output") { __typename }
    }`;
    });

    const variableDeclarations = chunk
      .map((_, idx) => `$owner_${idx}: String!, $name_${idx}: String!`)
      .join(", ");

    const query = `query BmadDetect(${variableDeclarations}) { ${repoFragments.join("\n")} }`;

    try {
      const response: Record<
        string,
        { bmad: { __typename: string } | null; bmadOutput: { __typename: string } | null } | null
      > = await octokit.graphql(query, variables);

      chunk.forEach((repo, idx) => {
        const data = response[`repo_${idx}`];
        results[repo.fullName] = !!(data?.bmad || data?.bmadOutput);
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[detectBmadRepos] GraphQL batch ${i / GRAPHQL_BATCH_SIZE + 1} failed: ${msg}`
      );
      for (const repo of chunk) {
        results[repo.fullName] = false;
      }
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

/**
 * Import a GitHub BMAD repo into the user's dashboard.
 */
export async function importRepo(input: {
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

  const authResult = await getAuthenticatedOctokit();
  if (!authResult.success) return authResult;

  const { userId } = authResult.data;

  if (!checkRateLimit(`import:${userId}`, 10, 60000)) {
    return { success: false, error: "Trop de requêtes", code: "RATE_LIMIT" };
  }

  try {
    const repo = await prisma.repo.create({
      data: {
        owner: data.owner,
        name: data.name,
        branch: data.defaultBranch,
        displayName: data.name,
        description: data.description,
        sourceType: "github",
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

export async function listGitLabRepos(): Promise<ActionResult<GitLabRepo[]>> {
  const authResult = await getAuthenticatedGitLabToken();
  if (!authResult.success) return authResult;

  const { token, userId } = authResult.data;

  if (!checkRateLimit(`list-gitlab:${userId}`, 30, 60000)) {
    return { success: false, error: "Trop de requÃªtes", code: "RATE_LIMIT" };
  }

  try {
    return { success: true, data: await listGitLabProjects(token) };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "GITLAB_ERROR"), code: "GITLAB_ERROR" };
  }
}

export async function detectGitLabBmadRepos(
  repoIds: { fullName: string; owner: string; name: string; defaultBranch: string }[],
): Promise<ActionResult<Record<string, boolean>>> {
  const authResult = await getAuthenticatedGitLabToken();
  if (!authResult.success) return authResult;

  const { token } = authResult.data;
  const results: Record<string, boolean> = {};

  for (const repo of repoIds) {
    try {
      const tree = await getGitLabRepoTree(token, repo.owner, repo.name, repo.defaultBranch);
      results[repo.fullName] = tree.some(
        (item) =>
          item.type === "tree" &&
          !item.path.includes("/") &&
          (item.path === BMAD_CORE || item.path === BMAD_OUTPUT),
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[detectGitLabBmadRepos] ${repo.fullName} failed: ${msg}`);
      results[repo.fullName] = false;
    }
  }

  return { success: true, data: results };
}

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
    return { success: false, error: "Trop de requÃªtes", code: "RATE_LIMIT" };
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
// Source-type-aware actions (GitHub + Local)
// ---------------------------------------------------------------------------

/**
 * Delete an imported repo from the user's dashboard (GitHub or local).
 */
export async function deleteRepo(
  input: RepoIdentityInput,
): Promise<ActionResult<{ deleted: boolean }>> {
  const parsed = repoIdentitySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid data", code: "VALIDATION_ERROR" };
  }

  // F15: Use session auth (no GitHub token required)
  const authResult = await requireAuthenticated();
  if (!authResult.success) return authResult;
  const { userId } = authResult.data;

  try {
    // F5: Always scope by userId
    const deleted = await prisma.repo.deleteMany({
      where:
        "repoId" in parsed.data
          ? { userId, id: parsed.data.repoId }
          : { userId, owner: parsed.data.owner, name: parsed.data.name },
    });

    if (deleted.count === 0) {
      return { success: false, error: "Repo not found", code: "NOT_FOUND" };
    }

    revalidatePath("/(dashboard)");
    return { success: true, data: { deleted: true } };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}

/**
 * Refresh repo data: re-fetch tree, count BMAD files, update lastSyncedAt.
 * Routes by sourceType for GitHub vs Local repos.
 */
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

    if (repoConfig.sourceType === "local") {
      return refreshLocalRepo(repoConfig);
    }

    return refreshRemoteRepo(repoConfig, userId);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "Provider rate limit reached. Cached data is displayed.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

async function refreshLocalRepo(
  repoConfig: { id: string; localPath: string | null },
): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  if (!repoConfig.localPath) {
    return { success: false, error: sanitizeError(null, "FS_ERROR"), code: "FS_ERROR" };
  }

  try {
    const provider = new LocalProvider(repoConfig.localPath);
    await provider.validateRoot();

    const tree = await provider.getTree();
    const totalFiles = tree.paths.filter((p) => p.startsWith("_bmad-output/")).length;

    const now = new Date();
    await prisma.repo.update({
      where: { id: repoConfig.id },
      data: { lastSyncedAt: now, totalFiles },
    });

    // F8: Revalidate dashboard RSC
    revalidatePath("/(dashboard)");
    // F37: No revalidateTag for local repos (no unstable_cache)

    return { success: true, data: { totalFiles, lastSyncedAt: now.toISOString() } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND" || msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "PATH_STALE"), code: "PATH_STALE" };
    }
    return { success: false, error: sanitizeError(error, "FS_ERROR"), code: "FS_ERROR" };
  }
}

async function refreshRemoteRepo(
  repoConfig: { id: string; owner: string; name: string; branch: string; sourceType: string },
  userId: string,
): Promise<ActionResult<{ totalFiles: number; lastSyncedAt: string }>> {
  revalidateTag(repoTag(repoConfig.sourceType, `${repoConfig.owner}/${repoConfig.name}`), "default");

  // Use the branch already configured for this repo — don't override it
  const syncBranch = repoConfig.branch;

  let totalFiles = 0;
  if (repoConfig.sourceType === "gitlab") {
    const token = await getGitLabToken(userId);
    if (!token) {
      return { success: false, error: "GitLab OAuth token not found.", code: "TOKEN_MISSING" };
    }
    const tree = await getGitLabRepoTree(token, repoConfig.owner, repoConfig.name, syncBranch);
    totalFiles = tree.filter(
      (item) => item.type === "blob" && item.path?.startsWith("_bmad-output/")
    ).length;
  } else {
    const token = await getGitHubToken(userId);
    if (!token) {
      return { success: false, error: "GitHub OAuth token not found.", code: "TOKEN_MISSING" };
    }
    const octokit = createUserOctokit(token);
    const { data: tree } = await octokit.rest.git.getTree({
      owner: repoConfig.owner,
      repo: repoConfig.name,
      tree_sha: syncBranch,
      recursive: "1",
    });
    totalFiles = tree.tree.filter(
      (item) => item.type === "blob" && item.path?.startsWith("_bmad-output/")
    ).length;
  }

  const now = new Date();
  await prisma.repo.update({
    where: { id: repoConfig.id },
    data: { lastSyncedAt: now, totalFiles },
  });

  return { success: true, data: { totalFiles, lastSyncedAt: now.toISOString() } };
}

// ---------------------------------------------------------------------------
// BMAD file browsing Server Actions
// ---------------------------------------------------------------------------

/**
 * Fetch the BMAD file tree for a repo.
 * Routes by sourceType for GitHub vs Local.
 */
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
    if (repoConfig.sourceType === "local") {
      if (!repoConfig.localPath) {
        return { success: false, error: sanitizeError(null, "FS_ERROR"), code: "FS_ERROR" };
      }
      return fetchBmadFilesLocal(repoConfig.localPath);
    }
    return fetchBmadFilesRemote(repoConfig, userId);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND" || msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "PATH_STALE"), code: "PATH_STALE" };
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: number }).status === 403
    ) {
      return {
        success: false,
        error: "Provider rate limit reached. Cached data is displayed.",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

async function fetchBmadFilesLocal(localPath: string) {
  const provider = new LocalProvider(localPath);
  await provider.validateRoot();
  const providerTree = await provider.getTree();
  const allPaths = providerTree.paths;

  const bmadPaths = allPaths.filter((p) => p.startsWith(BMAD_OUTPUT + "/"));
  const fileTree = buildFileTree(bmadPaths, BMAD_OUTPUT);

  const bmadCorePaths = allPaths.filter((p) => p.startsWith(BMAD_CORE + "/"));
  const bmadCoreTree = buildFileTree(bmadCorePaths, BMAD_CORE);

  // F20/F35: Detect docs/ via rootDirectories
  const docsFolderName = providerTree.rootDirectories.find(
    (d) => d.toLowerCase() === "docs"
  ) ?? null;
  const docsTree = docsFolderName
    ? buildFileTree(
        allPaths.filter((p) => p.startsWith(docsFolderName + "/")),
        docsFolderName,
      )
    : [];

  return { success: true as const, data: { fileTree, docsTree, bmadCoreTree, bmadFiles: bmadPaths } };
}

async function fetchBmadFilesRemote(
  repoConfig: { owner: string; name: string; branch: string; sourceType: string },
  userId: string,
) {
  const tree =
    repoConfig.sourceType === "gitlab"
      ? await (async () => {
          const token = await getGitLabToken(userId);
          if (!token) {
            throw Object.assign(new Error("GitLab OAuth token not found."), {
              code: "TOKEN_MISSING",
            });
          }
          return getCachedGitLabRepoTree(
            token,
            userId,
            repoConfig.owner,
            repoConfig.name,
            repoConfig.branch,
          );
        })()
      : await (async () => {
          const token = await getGitHubToken(userId);
          if (!token) {
            throw Object.assign(new Error("GitHub OAuth token not found."), {
              code: "TOKEN_MISSING",
            });
          }
          const octokit = createUserOctokit(token);
          const githubTree = await getCachedUserRepoTree(
            octokit,
            userId,
            repoConfig.owner,
            repoConfig.name,
            repoConfig.branch,
          );
          return githubTree.tree;
        })();

  const allPaths = tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path);

  const bmadPaths = allPaths.filter((p) => p.startsWith(BMAD_OUTPUT + "/"));
  const fileTree = buildFileTree(bmadPaths, BMAD_OUTPUT);

  const bmadCorePaths = allPaths.filter((p) => p.startsWith(BMAD_CORE + "/"));
  const bmadCoreTree = buildFileTree(bmadCorePaths, BMAD_CORE);

  // F20/F35: Detect docs/ via rootDirectories (from tree items)
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

/**
 * Fetch individual file content (lazy loading).
 * Routes by sourceType for GitHub vs Local.
 */
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
    let content: string;

    if (repoConfig.sourceType === "local") {
      if (!repoConfig.localPath) {
        return { success: false, error: sanitizeError(null, "FS_ERROR"), code: "FS_ERROR" };
      }
      const provider = new LocalProvider(repoConfig.localPath);
      content = await provider.getFileContent(parsed.data.path);
    } else if (repoConfig.sourceType === "gitlab") {
      const token = await getGitLabToken(userId);
      if (!token) {
        return { success: false, error: "GitLab OAuth token not found.", code: "TOKEN_MISSING" };
      }
      content = await getCachedGitLabRawContent(
        token,
        userId,
        repoConfig.owner,
        repoConfig.name,
        repoConfig.branch,
        parsed.data.path,
      );
    } else {
      const token = await getGitHubToken(userId);
      if (!token) {
        return { success: false, error: "GitHub OAuth token not found.", code: "TOKEN_MISSING" };
      }
      const octokit = createUserOctokit(token);
      content = await getCachedUserRawContent(
        octokit,
        userId,
        repoConfig.owner,
        repoConfig.name,
        repoConfig.branch,
        parsed.data.path,
      );
    }

    return { success: true, data: { content, contentType } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND" || msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "PATH_STALE"), code: "PATH_STALE" };
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error
    ) {
      const status = (error as { status: number }).status;
      if (status === 403) {
        return { success: false, error: "Provider rate limit reached.", code: "RATE_LIMITED" };
      }
      if (status === 404) {
        return { success: false, error: "File not found.", code: "NOT_FOUND" };
      }
    }
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

/**
 * Fetch and parse a BMAD file in a single server action call.
 */
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

// ---------------------------------------------------------------------------
// Local folder import (Task 16)
// ---------------------------------------------------------------------------

const importLocalFolderSchema = z.object({
  localPath: z
    .string()
    .min(1)
    .max(4096)
    .trim()
    .refine((p) => !p.includes("\0"), { message: "Invalid path" }) // F12: null bytes
    .refine((p) => !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(p), { message: "Invalid path" }), // F33
  displayName: z.string().min(1).max(255).trim().optional(),
});

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function sanitizeBasename(name: string): string {
  return name
    .replace(/[^a-z0-9-_]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/**
 * Import a local folder as a BMAD project.
 * F2: All FS operations go through LocalProvider (no direct fs calls).
 */
export async function importLocalFolder(input: {
  localPath: string;
  displayName?: string;
}): Promise<
  ActionResult<{ id: string; owner: string; name: string; displayName: string }>
> {
  // Guard: feature flag
  if (process.env.ENABLE_LOCAL_FS !== "true") {
    return { success: false, error: sanitizeError(null, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
  }

  const parsed = importLocalFolderSchema.safeParse(input);
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

  // F3: Rate limit
  if (!checkRateLimit(`import-local:${userId}`, 10, 60000)) {
    return { success: false, error: "Trop de requêtes", code: "RATE_LIMIT" };
  }

  try {
    // F2: Delegate all FS operations to LocalProvider
    const provider = new LocalProvider(parsed.data.localPath);
    await provider.validateRoot();

    const providerTree = await provider.getTree();

    // F36: Check for _bmad or _bmad-output in rootDirectories
    const hasBmad = providerTree.rootDirectories.some(
      (d) => d === "_bmad" || d === "_bmad-output"
    );
    if (!hasBmad) {
      return {
        success: false,
        error: "No _bmad or _bmad-output directory found in this folder.",
        code: "NO_BMAD",
      };
    }

    // F7/F19/F45: URL-safe name with collision-resistant hash
    const rawBasename = path.basename(parsed.data.localPath);
    const sanitizedBasename = sanitizeBasename(rawBasename);
    const hash = shortHash(parsed.data.localPath);
    const repoName = `${sanitizedBasename}-${hash}`;

    // F11: displayName fallback to raw basename
    const displayName = parsed.data.displayName ?? rawBasename;

    const bmadOutputCount = providerTree.paths.filter(
      (p) => p.startsWith("_bmad-output/")
    ).length;

    const repo = await prisma.repo.create({
      data: {
        owner: "local",
        name: repoName,
        branch: "local",
        displayName,
        sourceType: "local",
        localPath: parsed.data.localPath,
        totalFiles: bmadOutputCount,
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
        error: "This folder is already imported.",
        code: "DUPLICATE",
      };
    }
    const msg = error instanceof Error ? error.message : "";
    if (msg === "PATH_NOT_FOUND") {
      return { success: false, error: sanitizeError(error, "PATH_NOT_FOUND"), code: "PATH_NOT_FOUND" };
    }
    if (msg === "LOCAL_DISABLED") {
      return { success: false, error: sanitizeError(error, "LOCAL_DISABLED"), code: "LOCAL_DISABLED" };
    }
    return { success: false, error: sanitizeError(error, "FS_ERROR"), code: "FS_ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Branch management (GitHub-only)
// ---------------------------------------------------------------------------

/**
 * List available branches for a repo from GitHub.
 * F21: Returns error for local repos (no branch concept).
 */
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

  // F21: Guard — local repos don't have branches
  const repoConfig = await findUserRepo(userId, parsed.data);
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }
  if (repoConfig.sourceType === "local") {
    return { success: false, error: "Branch management is not available for local projects", code: "NOT_APPLICABLE" };
  }

  try {
    if (repoConfig.sourceType === "gitlab") {
      const token = await getGitLabToken(userId);
      if (!token) {
        return { success: false, error: "GitLab OAuth token not found.", code: "TOKEN_MISSING" };
      }
      return { success: true, data: await getGitLabBranches(token, repoConfig.owner, repoConfig.name) };
    }
    const token = await getGitHubToken(userId);
    if (!token) {
      return { success: false, error: "GitHub OAuth token not found.", code: "TOKEN_MISSING" };
    }
    const octokit = createUserOctokit(token);
    const branches = await octokit.paginate(
      octokit.rest.repos.listBranches,
      { owner: repoConfig.owner, repo: repoConfig.name, per_page: 100 },
    );
    return { success: true, data: branches.map((b) => b.name) };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "PROVIDER_ERROR"), code: "PROVIDER_ERROR" };
  }
}

/**
 * Update the tracked branch for a repo.
 * F21: Returns error for local repos.
 */
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

  // F21: Guard — local repos don't have branches
  const repoConfig = await findUserRepo(userId, parsed.data);
  if (!repoConfig) {
    return { success: false, error: "Project not found", code: "NOT_FOUND" };
  }
  if (repoConfig.sourceType === "local") {
    return { success: false, error: "Branch management is not available for local projects", code: "NOT_APPLICABLE" };
  }

  try {
    await prisma.repo.update({
      where: { id: repoConfig.id },
      data: { branch: parsed.data.branch },
    });

    revalidateTag(repoTag(repoConfig.sourceType, `${repoConfig.owner}/${repoConfig.name}`), "default");
    revalidatePath("/(dashboard)");

    return { success: true, data: { branch: parsed.data.branch } };
  } catch (error: unknown) {
    return { success: false, error: sanitizeError(error, "DB_ERROR"), code: "DB_ERROR" };
  }
}
