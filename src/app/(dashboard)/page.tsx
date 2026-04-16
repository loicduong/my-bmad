import { redirect } from "next/navigation";
import { getCachedBmadWorkspace } from "@/lib/bmad/cached-workspace";
import { getGitLabToken } from "@/lib/gitlab/token";
import { ReposGrid } from "@/components/dashboard/repos-grid";
import { GlobalStatsBar } from "@/components/dashboard/global-stats-bar";
import {
  getAuthenticatedUserId,
  getAuthenticatedGroups,
} from "@/lib/db/helpers";
import { AlertBanner } from "@/components/shared/alert-banner";
import type { BmadWorkspace } from "@/lib/bmad/types";

export default async function DashboardPage() {
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect("/login");

  const groups = await getAuthenticatedGroups(userId);
  const gitlabToken = await getGitLabToken(); // Now returns GITLAB_PAT or null

  const projects: BmadWorkspace[] = [];
  const errors: string[] = [];
  const results = await Promise.allSettled(
    groups.map((group) =>
      getCachedBmadWorkspace(
        group,
        { gitlabToken: gitlabToken ?? undefined },
        userId,
      ),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value !== null) {
      projects.push(result.value);
    } else if (result.status === "rejected") {
      const group = groups[i];
      const msg = result.reason?.message || String(result.reason);
      console.error(`Failed to fetch ${group.fullPath}:`, msg);
      errors.push(`${group.displayName}: ${msg}`);
    }
  }

  const hasErrors = errors.length > 0;

  return (
    <div className="mesh-gradient min-h-full">
      <div className="space-y-8 pt-6 lg:pt-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Overview of all your BMAD group workspaces
          </p>
        </div>
        {errors.length > 0 && (
          <AlertBanner
            variant="warning"
            title={errors.length === 1
              ? "1 project could not be loaded"
              : `${errors.length} projects could not be loaded`}
          >
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
            {hasErrors && (
              <p className="mt-2 text-xs text-muted-foreground">
                Ensure your GITLAB_PAT is correct and has &quot;read_api&quot; scope.
              </p>
            )}
          </AlertBanner>
        )}
        {projects.length > 0 && <GlobalStatsBar projects={projects} />}
        <ReposGrid
          projects={projects}
          groups={groups}
          gitlabEnabled={!!process.env.GITLAB_PAT}
        />
      </div>
    </div>
  );
}
