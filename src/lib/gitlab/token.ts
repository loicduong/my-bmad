import { prisma } from "@/lib/db/client";

interface GitLabTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function getGitLabIssuer(): string {
  return (process.env.GITLAB_ISSUER || "https://gitlab.com").replace(/\/+$/, "");
}

function isExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now() + 30_000;
}

export async function getGitLabToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "gitlab" },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      accessTokenExpiresAt: true,
    },
  });

  if (!account?.accessToken) return null;
  if (!isExpired(account.accessTokenExpiresAt)) return account.accessToken;
  if (!account.refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: process.env.GITLAB_CLIENT_ID ?? "",
    client_secret: process.env.GITLAB_CLIENT_SECRET ?? "",
  });

  const response = await fetch(`${getGitLabIssuer()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;

  const tokens = (await response.json()) as GitLabTokenResponse;
  if (!tokens.access_token) return null;

  const accessTokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await prisma.account.update({
    where: { id: account.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? account.refreshToken,
      accessTokenExpiresAt,
      scope: tokens.scope,
    },
  });

  return tokens.access_token;
}
