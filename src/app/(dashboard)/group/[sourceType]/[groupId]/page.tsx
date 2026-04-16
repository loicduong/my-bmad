import { redirect, notFound } from "next/navigation";
import { getCachedBmadWorkspace } from "@/lib/bmad/cached-workspace";
import { getGitLabToken } from "@/lib/gitlab/token";
import { ProgressRing } from "@/components/shared/progress-ring";
import { ProjectStatsGrid } from "@/components/dashboard/project-stats-grid";
import { EpicsList } from "@/components/dashboard/epics-list";
import { VelocityMetrics } from "@/components/dashboard/velocity-metrics";
import { KeyArtifactsCard } from "@/components/dashboard/key-artifacts-card";
import { GitBranch, Clock, Gitlab } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { DeleteRepoButton } from "@/components/shared/delete-repo-button";
import { RefreshRepoButton } from "@/components/shared/refresh-repo-button";
import { GroupSettingsModal } from "@/components/shared/group-settings-modal";
import { getGroupHref } from "@/lib/repo-routes";
import {
  getAuthenticatedUserId,
  getAuthenticatedGroupConfigById,
} from "@/lib/db/helpers";
import type { FileTreeNode } from "@/lib/bmad/types";

interface GroupPageProps {
  params: Promise<{ sourceType: string; groupId: string }>;
}

function extractPlanningArtifacts(fileTree: FileTreeNode[]): FileTreeNode[] {
  const planningDir = fileTree.find(
    (node) =>
      node.type === "directory" &&
      node.name.toLowerCase().includes("planning-artifacts"),
  );
  return planningDir?.children ?? [];
}

function getSprintProgress(project: {
  sprintStatus: { stories: { status: string }[] } | null;
}): number | null {
  if (!project.sprintStatus) return null;
  const stories = project.sprintStatus.stories;
  if (stories.length === 0) return null;
  const done = stories.filter((s) => s.status === "done").length;
  return Math.round((done / stories.length) * 100);
}

export default async function GroupOverviewPage({ params }: GroupPageProps) {
  const { sourceType, groupId } = await params;
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect("/login");

  const groupConfig = await getAuthenticatedGroupConfigById(userId, groupId);
  if (!groupConfig) return notFound();
  if (groupConfig.sourceType !== sourceType) return notFound();

  const gitlabToken = await getGitLabToken(userId);
  const project = await getCachedBmadWorkspace(
    groupConfig,
    { gitlabToken: gitlabToken ?? undefined },
    userId,
  );
  const planningArtifacts = extractPlanningArtifacts(project.fileTree);
  const docsHref = getGroupHref(groupConfig.sourceType, groupConfig.id, "docs");
  const epicsHref = getGroupHref(groupConfig.sourceType, groupConfig.id, "epics");

  return (
    <div className="space-y-8 pb-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">
              {project.displayName}
            </h1>
            <RefreshRepoButton groupId={groupConfig.id} />
            <GroupSettingsModal
              displayName={project.displayName}
              repos={groupConfig.repos}
            />
            <DeleteRepoButton
              groupId={groupConfig.id}
              displayName={project.displayName}
            />
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Gitlab className="h-4 w-4" />
            <span>{project.groupFullPath}</span>
            <GitBranch className="h-4 w-4" />
            <span>{project.reposCount} repos</span>
            {groupConfig.lastSyncedAt && (
              <>
                <span className="text-muted-foreground/50">&middot;</span>
                <Clock className="h-3.5 w-3.5" />
                <span>{formatRelativeTime(groupConfig.lastSyncedAt)}</span>
              </>
            )}
          </div>
        </div>
        <ProgressRing
          percent={project.progressPercent}
          size={72}
          strokeWidth={5}
        />
      </div>

      {project.repoBreakdown.some((repo) => repo.error) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
          <p className="font-medium text-warning-foreground">
            Some repositories could not be loaded.
          </p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {project.repoBreakdown
              .filter((repo) => repo.error)
              .map((repo) => (
                <li key={repo.repoId}>
                  {repo.displayName}: {repo.error}
                </li>
              ))}
          </ul>
        </div>
      )}

      <ProjectStatsGrid
        totalEpics={project.epics.length}
        totalStories={project.totalStories}
        completedStories={project.completedStories}
        sprintProgress={getSprintProgress(project)}
      />

      {project.sprintStatus && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Velocity Metrics</h2>
          <VelocityMetrics sprintStatus={project.sprintStatus} />
        </section>
      )}

      <KeyArtifactsCard
        planningArtifacts={planningArtifacts}
        sourceType={groupConfig.sourceType}
        repoId={groupConfig.repos[0]?.id ?? groupConfig.id}
        hrefBase={docsHref}
      />

      <EpicsList
        epics={project.epics}
        sourceType={groupConfig.sourceType}
        repoId={groupConfig.id}
        hrefBase={epicsHref}
      />
    </div>
  );
}
