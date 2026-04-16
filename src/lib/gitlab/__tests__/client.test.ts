import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGitLabRawContent,
  getGitLabRepoTree,
  getGitLabBranches,
  getGitLabProjectId,
  listGitLabGroups,
  listGitLabGroupProjects,
  detectGitLabBmadProjects,
} from "../client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  delete process.env.GITLAB_ISSUER;
});

describe("GitLab client", () => {
  it("encodes nested namespace project IDs for GitLab API URLs", () => {
    expect(getGitLabProjectId("group/subgroup", "project")).toBe(
      "group%2Fsubgroup%2Fproject",
    );
  });

  it("fetches a recursive repository tree from the configured issuer", async () => {
    process.env.GITLAB_ISSUER = "https://gitlab.example.com/";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { path: "_bmad", type: "tree" },
        { path: "_bmad/config.yaml", type: "blob" },
      ],
    });

    const tree = await getGitLabRepoTree(
      "token",
      "group/subgroup",
      "project",
      "main",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/projects/group%2Fsubgroup%2Fproject/repository/tree?recursive=true&per_page=100&ref=main",
      { headers: { Authorization: "Bearer token" } },
    );
    expect(tree).toEqual([
      { path: "_bmad", type: "tree" },
      { path: "_bmad/config.yaml", type: "blob" },
    ]);
  });

  it("fetches raw file content using URL encoded file paths", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "# Report",
    });

    const content = await getGitLabRawContent(
      "token",
      "group",
      "project",
      "main",
      "_bmad-output/report.md",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/projects/group%2Fproject/repository/files/_bmad-output%2Freport.md/raw?ref=main",
      { headers: { Authorization: "Bearer token" } },
    );
    expect(content).toBe("# Report");
  });

  it("fetches branch names", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ name: "main" }, { name: "release/1" }],
    });

    await expect(getGitLabBranches("token", "group", "project")).resolves.toEqual([
      "main",
      "release/1",
    ]);
  });

  it("lists accessible groups with pagination", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => (name === "x-next-page" ? "2" : "") },
        json: async () => [
          {
            id: 10,
            name: "Platform",
            full_path: "org/platform",
            description: "Platform group",
            visibility: "private",
            web_url: "https://gitlab.com/org/platform",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "" },
        json: async () => [
          {
            id: 11,
            name: "Mobile",
            full_path: "org/mobile",
            description: null,
            visibility: "public",
            web_url: "https://gitlab.com/org/mobile",
          },
        ],
      });

    await expect(listGitLabGroups("token")).resolves.toEqual([
      {
        id: 10,
        name: "Platform",
        fullPath: "org/platform",
        description: "Platform group",
        isPrivate: true,
        webUrl: "https://gitlab.com/org/platform",
      },
      {
        id: 11,
        name: "Mobile",
        fullPath: "org/mobile",
        description: null,
        isPrivate: false,
        webUrl: "https://gitlab.com/org/mobile",
      },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://gitlab.com/api/v4/groups?min_access_level=10&top_level_only=false&order_by=name&sort=asc&per_page=100",
      { headers: { Authorization: "Bearer token" } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://gitlab.com/api/v4/groups?min_access_level=10&top_level_only=false&order_by=name&sort=asc&per_page=100&page=2",
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("lists descendant projects for a group with include_subgroups", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: { get: () => "" },
      json: async () => [
        {
          id: 20,
          path: "project-a",
          path_with_namespace: "org/platform/sub/project-a",
          namespace: { full_path: "org/platform/sub" },
          description: "A",
          visibility: "private",
          last_activity_at: "2026-04-01T00:00:00Z",
          default_branch: "develop",
        },
      ],
    });

    await expect(listGitLabGroupProjects("token", "org/platform")).resolves.toEqual([
      {
        id: 20,
        fullName: "org/platform/sub/project-a",
        owner: "org/platform/sub",
        name: "project-a",
        description: "A",
        isPrivate: true,
        updatedAt: "2026-04-01T00:00:00Z",
        defaultBranch: "develop",
        hasBmad: false,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/groups/org%2Fplatform/projects?include_subgroups=true&simple=true&order_by=last_activity_at&sort=desc&per_page=100",
      { headers: { Authorization: "Bearer token" } },
    );
  });

  it("detects BMAD projects and always includes project-general when present", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "" },
        json: async () => [{ path: "README.md", type: "blob" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "" },
        json: async () => [{ path: "_bmad-output", type: "tree" }],
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "" },
        json: async () => [{ path: "src/index.ts", type: "blob" }],
      });

    const projects = [
      {
        id: 1,
        fullName: "org/platform/project-general",
        owner: "org/platform",
        name: "project-general",
        description: null,
        isPrivate: true,
        updatedAt: "",
        defaultBranch: "main",
        hasBmad: false,
      },
      {
        id: 2,
        fullName: "org/platform/sub/project-a",
        owner: "org/platform/sub",
        name: "project-a",
        description: null,
        isPrivate: true,
        updatedAt: "",
        defaultBranch: "main",
        hasBmad: false,
      },
      {
        id: 3,
        fullName: "org/platform/sub/project-b",
        owner: "org/platform/sub",
        name: "project-b",
        description: null,
        isPrivate: true,
        updatedAt: "",
        defaultBranch: "main",
        hasBmad: false,
      },
    ];

    await expect(detectGitLabBmadProjects("token", projects, 2)).resolves.toEqual([
      { ...projects[0], hasBmad: false, role: "general" },
      { ...projects[1], hasBmad: true, role: "member" },
    ]);
  });
});
