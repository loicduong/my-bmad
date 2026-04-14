/**
 * Retrieves the GitLab token for API requests.
 * Since OAuth has been removed, this now exclusively returns the GITLAB_PAT from environment variables.
 */
export async function getGitLabToken(_userId?: string): Promise<string | null> {
  // We no longer use userId or database accounts for GitLab access.
  // All interactions are performed using the global PAT.
  return process.env.GITLAB_PAT || null;
}
