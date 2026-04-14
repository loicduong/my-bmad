export type { ContentProvider, ContentProviderTree } from "./types";
export { GitLabProvider } from "./gitlab-provider";

import type { ContentProvider } from "./types";
import type { RepoConfig } from "@/lib/types";
import { GitLabProvider } from "./gitlab-provider";

interface ContentProviderOptions {
  gitlabToken?: string;
  userId?: string;
}

export function createContentProvider(
  config: RepoConfig,
  options: ContentProviderOptions,
): ContentProvider {
  if (!options.gitlabToken || !options.userId) {
    throw new Error("GitLab provider requires gitlabToken and userId");
  }

  return new GitLabProvider(
    options.gitlabToken,
    options.userId,
    config.owner,
    config.name,
    config.branch,
  );
}
