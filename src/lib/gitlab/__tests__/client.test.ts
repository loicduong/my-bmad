import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGitLabRawContent,
  getGitLabRepoTree,
  getGitLabBranches,
  getGitLabProjectId,
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
});
