export type { ContentProvider, ContentProviderTree } from "./types";
export { LOCAL_PROVIDER_DEFAULTS } from "./types";
export { GitHubProvider } from "./github-provider";
export { GitLabProvider } from "./gitlab-provider";
export { LocalProvider } from "./local-provider";

import type { ContentProvider } from "./types";
import type { RepoConfig } from "@/lib/types";
import type { UserOctokit } from "@/lib/github/client";
import { GitHubProvider } from "./github-provider";
import { GitLabProvider } from "./gitlab-provider";
import { LocalProvider } from "./local-provider";

interface ContentProviderOptions {
  octokit?: UserOctokit;
  gitlabToken?: string;
  userId?: string;
}

export function createContentProvider(
  config: RepoConfig,
  optionsOrOctokit?: ContentProviderOptions | UserOctokit,
  legacyUserId?: string,
): ContentProvider {
  const options: ContentProviderOptions =
    optionsOrOctokit && "userId" in optionsOrOctokit
      ? optionsOrOctokit
      : { octokit: optionsOrOctokit as UserOctokit | undefined, userId: legacyUserId };

  if (config.sourceType === "local") {
    if (!config.localPath) throw new Error("Local provider requires localPath");
    return new LocalProvider(config.localPath);
  }
  if (config.sourceType === "gitlab") {
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
  if (!options.octokit || !options.userId)
    throw new Error("GitHub provider requires octokit and userId");
  return new GitHubProvider(
    options.octokit,
    options.userId,
    config.owner,
    config.name,
    config.branch,
  );
}
