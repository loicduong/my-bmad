import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContentProvider } from "../index";
import { GitLabProvider } from "../gitlab-provider";

vi.mock("@/lib/gitlab/client", () => ({
  getCachedGitLabRepoTree: vi.fn(),
  getCachedGitLabRawContent: vi.fn(),
}));

import {
  getCachedGitLabRepoTree,
  getCachedGitLabRawContent,
} from "@/lib/gitlab/client";

const mockTree = getCachedGitLabRepoTree as ReturnType<typeof vi.fn>;
const mockContent = getCachedGitLabRawContent as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GitLabProvider", () => {
  it("returns paths from blob items and rootDirectories from root tree items", async () => {
    mockTree.mockResolvedValue([
      { path: "_bmad", type: "tree" },
      { path: "docs", type: "tree" },
      { path: "_bmad/config.yaml", type: "blob" },
      { path: "docs/readme.md", type: "blob" },
      { path: "src/nested", type: "tree" },
    ]);

    const provider = new GitLabProvider(
      "token",
      "user1",
      "group/subgroup",
      "project",
      "main",
    );

    await expect(provider.getTree()).resolves.toEqual({
      paths: ["_bmad/config.yaml", "docs/readme.md"],
      rootDirectories: ["_bmad", "docs"],
    });
  });

  it("returns file content from cached helper", async () => {
    mockContent.mockResolvedValue("file content");

    const provider = new GitLabProvider("token", "user1", "group", "project", "main");
    await expect(provider.getFileContent("_bmad/file.md")).resolves.toBe(
      "file content",
    );
    expect(mockContent).toHaveBeenCalledWith(
      "token",
      "user1",
      "group",
      "project",
      "main",
      "_bmad/file.md",
    );
  });
});

describe("createContentProvider", () => {
  it("creates a GitLabProvider for gitlab repos", () => {
    const provider = createContentProvider(
      {
        id: "repo1",
        owner: "group",
        name: "project",
        branch: "main",
        displayName: "project",
        description: null,
        sourceType: "gitlab",
        localPath: null,
        lastSyncedAt: null,
      },
      { gitlabToken: "token", userId: "user1" },
    );

    expect(provider).toBeInstanceOf(GitLabProvider);
  });
});
