import { cache } from "react";
import { createContentProvider } from "@/lib/content-provider";
import { getBmadWorkspace } from "./workspace";
import type { GroupConfig } from "@/lib/types";
import type { BmadWorkspace } from "./types";

type ProviderTokens =
  | string
  | {
      gitlabToken?: string;
    }
  | undefined;

export const getCachedBmadWorkspace = cache(
  async (
    group: GroupConfig,
    tokens: ProviderTokens,
    userId: string | undefined,
  ): Promise<BmadWorkspace> => {
    const gitlabToken =
      typeof tokens === "string" ? tokens : tokens?.gitlabToken;

    const repoProviders = group.repos.map((repo) => ({
      repo,
      provider: createContentProvider(repo, { gitlabToken, userId }),
    }));

    return getBmadWorkspace(group, repoProviders);
  },
);
