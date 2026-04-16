import { prisma } from "@/lib/db/client";

function getGitLabIssuer(): string {
  return (process.env.GITLAB_ISSUER || "https://gitlab.com").replace(/\/+$/, "");
}

async function refreshGitLabToken(account: {
  id: string;
  refreshToken: string | null;
}): Promise<string | null> {
  if (!account.refreshToken) return null;
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(`${getGitLabIssuer()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) return null;

  await prisma.account.update({
    where: { id: account.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? account.refreshToken,
      accessTokenExpiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
      scope: data.scope,
    },
  });

  return data.access_token;
}

export async function getGitLabToken(userId?: string): Promise<string | null> {
  if (process.env.GITLAB_PAT) return process.env.GITLAB_PAT;
  if (!userId) return null;

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

  if (
    !account.accessTokenExpiresAt ||
    account.accessTokenExpiresAt.getTime() > Date.now() + 30_000
  ) {
    return account.accessToken;
  }

  return refreshGitLabToken(account);
}
