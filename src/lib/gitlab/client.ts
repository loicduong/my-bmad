import { unstable_cache } from "next/cache";
import { fileTag, repoTag } from "@/lib/cache-tags";

export interface GitLabTreeItem {
  id?: string;
  name?: string;
  path: string;
  type: "blob" | "tree";
  mode?: string;
}

export interface GitLabRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  isPrivate: boolean;
  updatedAt: string;
  defaultBranch: string;
  hasBmad: boolean;
}

const CACHE_TTL = 300;

function getGitLabIssuer(): string {
  return (process.env.GITLAB_ISSUER || "https://gitlab.com").replace(/\/+$/, "");
}

function getGitLabApiBase(): string {
  return `${getGitLabIssuer()}/api/v4`;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean>) {
  const url = new URL(`${getGitLabApiBase()}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function gitLabPaginatedJson<T>(
  accessToken: string,
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      buildUrl(path, page === 1 ? params : { ...params, page }),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      throw Object.assign(new Error(`GitLab request failed: ${response.status}`), {
        status: response.status,
      });
    }

    items.push(...((await response.json()) as T[]));

    const nextPage = response.headers?.get("x-next-page");
    if (!nextPage) return items;
    page = Number(nextPage);
    if (!Number.isFinite(page) || page < 1) return items;
  }
}

export function getGitLabProjectId(owner: string, name: string): string {
  return encodeURIComponent(`${owner}/${name}`);
}

export async function listGitLabProjects(
  accessToken: string,
): Promise<GitLabRepo[]> {
  const projects = await gitLabPaginatedJson<
    {
      id: number;
      path: string;
      path_with_namespace: string;
      namespace?: { full_path?: string };
      description: string | null;
      visibility: string;
      last_activity_at: string | null;
      default_branch: string | null;
    }
  >(
    accessToken,
    "/projects",
    {
      membership: true,
      simple: true,
      order_by: "last_activity_at",
      sort: "desc",
      per_page: 100,
    },
  );

  return projects.map((project) => ({
    id: project.id,
    fullName: project.path_with_namespace,
    owner: project.namespace?.full_path ?? project.path_with_namespace.split("/").slice(0, -1).join("/"),
    name: project.path,
    description: project.description ?? null,
    isPrivate: project.visibility !== "public",
    updatedAt: project.last_activity_at ?? "",
    defaultBranch: project.default_branch ?? "main",
    hasBmad: false,
  }));
}

export async function getGitLabRepoTree(
  accessToken: string,
  owner: string,
  name: string,
  branch: string,
): Promise<GitLabTreeItem[]> {
  const projectId = getGitLabProjectId(owner, name);
  return gitLabPaginatedJson<GitLabTreeItem>(
    accessToken,
    `/projects/${projectId}/repository/tree`,
    {
      recursive: true,
      per_page: 100,
      ref: branch,
    },
  );
}

export async function getGitLabRawContent(
  accessToken: string,
  owner: string,
  name: string,
  branch: string,
  path: string,
): Promise<string> {
  const projectId = getGitLabProjectId(owner, name);
  const filePath = encodeURIComponent(path);
  const response = await fetch(
    buildUrl(`/projects/${projectId}/repository/files/${filePath}/raw`, {
      ref: branch,
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw Object.assign(new Error(`GitLab request failed: ${response.status}`), {
      status: response.status,
    });
  }
  return response.text();
}

export async function getGitLabBranches(
  accessToken: string,
  owner: string,
  name: string,
): Promise<string[]> {
  const projectId = getGitLabProjectId(owner, name);
  const branches = await gitLabPaginatedJson<{ name: string }>(
    accessToken,
    `/projects/${projectId}/repository/branches`,
    { per_page: 100 },
  );
  return branches.map((branch) => branch.name);
}

export function getCachedGitLabRepoTree(
  accessToken: string,
  userId: string,
  owner: string,
  name: string,
  branch: string,
) {
  return unstable_cache(
    () => getGitLabRepoTree(accessToken, owner, name, branch),
    ["gitlab-repo-tree", userId, owner, name, branch],
    { revalidate: CACHE_TTL, tags: [repoTag("gitlab", `${owner}/${name}`)] },
  )();
}

export function getCachedGitLabRawContent(
  accessToken: string,
  userId: string,
  owner: string,
  name: string,
  branch: string,
  path: string,
) {
  return unstable_cache(
    () => getGitLabRawContent(accessToken, owner, name, branch, path),
    ["gitlab-file-content", userId, owner, name, branch, path],
    {
      revalidate: CACHE_TTL,
      tags: [
        repoTag("gitlab", `${owner}/${name}`),
        fileTag("gitlab", `${owner}/${name}`, path),
      ],
    },
  )();
}
