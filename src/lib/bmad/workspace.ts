import { getBmadProject } from "./parser";
import type { ContentProvider } from "@/lib/content-provider";
import type { GroupConfig, RepoConfig } from "@/lib/types";
import type {
  BmadProject,
  BmadRepoBreakdown,
  BmadWorkspace,
  Epic,
  StoryDetail,
} from "./types";

type RepoProvider = {
  repo: RepoConfig;
  provider: ContentProvider;
};

function repoFullPath(repo: RepoConfig): string {
  return repo.fullPath ?? `${repo.owner}/${repo.name}`;
}

function emptyBreakdown(repo: RepoConfig, error: string | null): BmadRepoBreakdown {
  return {
    repoId: repo.id,
    repoFullPath: repoFullPath(repo),
    repoRole: repo.role,
    displayName: repo.displayName,
    branch: repo.branch,
    totalStories: 0,
    completedStories: 0,
    progressPercent: 0,
    error,
  };
}

function breakdownFromProject(repo: RepoConfig, project: BmadProject): BmadRepoBreakdown {
  return {
    repoId: repo.id,
    repoFullPath: repoFullPath(repo),
    repoRole: repo.role,
    displayName: repo.displayName,
    branch: repo.branch,
    totalStories: project.totalStories,
    completedStories: project.completedStories,
    progressPercent: project.progressPercent,
    error: null,
  };
}

function sortRepoProviders(items: RepoProvider[]) {
  return [...items].sort((a, b) => {
    if (a.repo.role !== b.repo.role) return a.repo.role === "general" ? -1 : 1;
    return repoFullPath(a.repo).localeCompare(repoFullPath(b.repo));
  });
}

export async function getBmadWorkspace(
  group: GroupConfig,
  repoProviders: RepoProvider[],
): Promise<BmadWorkspace> {
  const projects: BmadProject[] = [];
  const repoBreakdown: BmadRepoBreakdown[] = [];

  for (const item of sortRepoProviders(repoProviders)) {
    try {
      const project = await getBmadProject(item.repo, item.provider);
      if (project) {
        projects.push(project);
        repoBreakdown.push(breakdownFromProject(item.repo, project));
      } else {
        repoBreakdown.push(emptyBreakdown(item.repo, null));
      }
    } catch (error) {
      repoBreakdown.push(
        emptyBreakdown(
          item.repo,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }

  const epics: Epic[] = projects.flatMap((project) => project.epics);
  const stories: StoryDetail[] = projects.flatMap((project) => project.stories);
  const totalStories = projects.reduce((sum, project) => sum + project.totalStories, 0);
  const completedStories = projects.reduce(
    (sum, project) => sum + project.completedStories,
    0,
  );
  const inProgressStories = projects.reduce(
    (sum, project) => sum + project.inProgressStories,
    0,
  );
  const bmadFiles = projects.flatMap((project) =>
    project.bmadFiles.map((path) => `${project.id}:${path}`),
  );
  const parseErrors = projects.flatMap((project) =>
    project.parseHealth?.errors.map((error) => ({
      ...error,
      file: `${project.displayName}/${error.file}`,
    })) ?? [],
  );
  const totalParsedFiles = projects.reduce(
    (sum, project) => sum + (project.parseHealth?.totalFiles ?? 0),
    0,
  );
  const successfulFiles = projects.reduce(
    (sum, project) => sum + (project.parseHealth?.successfulFiles ?? 0),
    0,
  );

  return {
    id: group.id,
    owner: group.fullPath,
    repo: group.name,
    sourceType: group.sourceType,
    branch: "multi-repo",
    displayName: group.displayName,
    sprintStatus: projects.find((project) => project.sprintStatus)?.sprintStatus ?? null,
    epics,
    stories,
    fileTree: projects.flatMap((project) => project.fileTree),
    bmadFiles,
    docsTree: projects.flatMap((project) => project.docsTree),
    docsFolderName: null,
    parseHealth: {
      errors: parseErrors,
      totalFiles: totalParsedFiles,
      successfulFiles,
    },
    totalStories,
    completedStories,
    inProgressStories,
    progressPercent:
      totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0,
    groupFullPath: group.fullPath,
    reposCount: repoProviders.length,
    repoBreakdown,
  };
}
