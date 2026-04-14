import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGitLabToken } from "../token";

const { accountFindFirst, accountUpdate } = vi.hoisted(() => ({
  accountFindFirst: vi.fn(),
  accountUpdate: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    account: {
      findFirst: accountFindFirst,
      update: accountUpdate,
    },
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.useRealTimers();
  accountFindFirst.mockReset();
  accountUpdate.mockReset();
  fetchMock.mockReset();
  process.env.GITLAB_CLIENT_ID = "client-id";
  process.env.GITLAB_CLIENT_SECRET = "client-secret";
  delete process.env.GITLAB_ISSUER;
});

describe("getGitLabToken", () => {
  it("returns null when no GitLab account exists", async () => {
    accountFindFirst.mockResolvedValue(null);

    await expect(getGitLabToken("user1")).resolves.toBeNull();
  });

  it("returns the stored token when it has not expired", async () => {
    accountFindFirst.mockResolvedValue({
      id: "account1",
      accessToken: "stored-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(getGitLabToken("user1")).resolves.toBe("stored-token");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the new token", async () => {
    accountFindFirst.mockResolvedValue({
      id: "account1",
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-token",
        refresh_token: "new-refresh-token",
        expires_in: 7200,
        scope: "read_user read_api read_repository",
      }),
    });

    await expect(getGitLabToken("user1")).resolves.toBe("new-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.com/oauth/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: "account1" },
      data: expect.objectContaining({
        accessToken: "new-token",
        refreshToken: "new-refresh-token",
        scope: "read_user read_api read_repository",
      }),
    });
  });
});
