import { describe, expect, it } from "vitest";
import { getBmadWorkspace } from "../workspace";
import type { ContentProvider } from "@/lib/content-provider";
import type { GroupConfig, RepoConfig } from "@/lib/types";

function provider(files: Record<string, string>): ContentProvider {
  return {
    async getTree() {
      const paths = Object.keys(files);
      const rootDirectories = Array.from(
        new Set(paths.map((path) => path.split("/")[0]).filter(Boolean)),
      );
      return { paths, rootDirectories };
    },
    async getFileContent(filePath: string) {
      const content = files[filePath];
      if (content === undefined) throw new Error(`Missing ${filePath}`);
      return content;
    },
    async validateRoot() {},
  };
}

function repo(overrides: Partial<RepoConfig>): RepoConfig {
  return {
    id: "repo-1",
    owner: "org/platform",
    name: "project-general",
    fullPath: "org/platform/project-general",
    branch: "main",
    displayName: "project-general",
    description: null,
    sourceType: "gitlab",
    localPath: null,
    lastSyncedAt: null,
    groupId: "group-1",
    role: "general",
    ...overrides,
  };
}

const group: GroupConfig = {
  id: "group-1",
  sourceType: "gitlab",
  gitlabGroupId: 10,
  fullPath: "org/platform",
  name: "platform",
  displayName: "Platform",
  description: null,
  lastSyncedAt: null,
  repos: [],
};

describe("getBmadWorkspace", () => {
  it("merges project-general and member repos into one workspace with repo breakdown", async () => {
    const general = repo({ id: "general", role: "general" });
    const projectA = repo({
      id: "project-a",
      owner: "org/platform/sub",
      name: "project-a",
      fullPath: "org/platform/sub/project-a",
      displayName: "project-a",
      role: "member",
    });

    const workspace = await getBmadWorkspace(group, [
      {
        repo: general,
        provider: provider({
          "_bmad-output/planning-artifacts/epics.md":
            "## Epic 1: Shared Platform\n\nShared work\n\n- Story 1.1 - Shared Setup",
          "_bmad-output/implementation-artifacts/1-1-shared-setup.md":
            "# Story 1.1: Shared Setup\n\n## Acceptance Criteria\n- Works\n\n## Tasks\n- [x] Wire shared",
        }),
      },
      {
        repo: projectA,
        provider: provider({
          "_bmad-output/planning-artifacts/epics.md":
            "## Epic 2: Project A\n\nA work\n\n- Story 2.1 - Build A",
          "_bmad-output/implementation-artifacts/2-1-build-a.md":
            "# Story 2.1: Build A\n\n## Acceptance Criteria\n- Works\n\n## Tasks\n- [ ] Build",
        }),
      },
    ]);

    expect(workspace.id).toBe("group-1");
    expect(workspace.displayName).toBe("Platform");
    expect(workspace.repoBreakdown).toEqual([
      {
        repoId: "general",
        repoFullPath: "org/platform/project-general",
        repoRole: "general",
        displayName: "project-general",
        branch: "main",
        totalStories: 1,
        completedStories: 0,
        progressPercent: 0,
        error: null,
      },
      {
        repoId: "project-a",
        repoFullPath: "org/platform/sub/project-a",
        repoRole: "member",
        displayName: "project-a",
        branch: "main",
        totalStories: 1,
        completedStories: 0,
        progressPercent: 0,
        error: null,
      },
    ]);
    expect(workspace.epics.map((epic) => epic.title)).toEqual([
      "Shared Platform",
      "Project A",
    ]);
    expect(workspace.totalStories).toBe(2);
  });

  it("keeps workspace loadable when a member repo fails", async () => {
    const general = repo({ id: "general", role: "general" });
    const broken = repo({
      id: "broken",
      owner: "org/platform/sub",
      name: "project-b",
      fullPath: "org/platform/sub/project-b",
      displayName: "project-b",
      role: "member",
    });

    const workspace = await getBmadWorkspace(group, [
      {
        repo: general,
        provider: provider({
          "_bmad-output/planning-artifacts/epics.md":
            "## Epic 1: Shared Platform\n\nShared work",
        }),
      },
      {
        repo: broken,
        provider: {
          async getTree() {
            throw new Error("GitLab request failed: 404");
          },
          async getFileContent() {
            return "";
          },
          async validateRoot() {},
        },
      },
    ]);

    expect(workspace.epics.map((epic) => epic.title)).toEqual(["Shared Platform"]);
    expect(workspace.repoBreakdown).toContainEqual({
      repoId: "broken",
      repoFullPath: "org/platform/sub/project-b",
      repoRole: "member",
      displayName: "project-b",
      branch: "main",
      totalStories: 0,
      completedStories: 0,
      progressPercent: 0,
      error: "GitLab request failed: 404",
    });
  });
});
