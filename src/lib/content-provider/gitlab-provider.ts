import type { ContentProvider, ContentProviderTree } from "./types";
import {
  getCachedGitLabRawContent,
  getCachedGitLabRepoTree,
} from "@/lib/gitlab/client";

export class GitLabProvider implements ContentProvider {
  constructor(
    private accessToken: string,
    private userId: string,
    private owner: string,
    private repo: string,
    private branch: string,
  ) {}

  async getTree(): Promise<ContentProviderTree> {
    const tree = await getCachedGitLabRepoTree(
      this.accessToken,
      this.userId,
      this.owner,
      this.repo,
      this.branch,
    );

    const paths: string[] = [];
    const rootDirectories: string[] = [];

    for (const item of tree) {
      if (item.type === "blob") {
        paths.push(item.path);
      } else if (item.type === "tree" && !item.path.includes("/")) {
        rootDirectories.push(item.path);
      }
    }

    return { paths, rootDirectories };
  }

  async getFileContent(filePath: string): Promise<string> {
    return getCachedGitLabRawContent(
      this.accessToken,
      this.userId,
      this.owner,
      this.repo,
      this.branch,
      filePath,
    );
  }

  async validateRoot(): Promise<void> {
    // No-op: the repo exists if it's in the DB.
  }
}
