import { describe, expect, it } from "vitest";
import { getGroupHref, getRepoHref } from "../repo-routes";

describe("repo route helpers", () => {
  it("builds provider-scoped repo routes with encoded IDs", () => {
    expect(getRepoHref("gitlab", "repo_123")).toBe("/repo/gitlab/repo_123");
    expect(getRepoHref("gitlab", "repo/123", "docs")).toBe(
      "/repo/gitlab/repo%2F123/docs",
    );
  });

  it("builds provider-scoped group routes with encoded IDs", () => {
    expect(getGroupHref("gitlab", "group_123")).toBe("/group/gitlab/group_123");
    expect(getGroupHref("gitlab", "group/123", "stories")).toBe(
      "/group/gitlab/group%2F123/stories",
    );
  });
});
