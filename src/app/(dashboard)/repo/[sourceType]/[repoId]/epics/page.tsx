import { redirect, notFound } from "next/navigation";
import { getCachedBmadProject } from "@/lib/bmad/cached-project";
import { getGitLabToken } from "@/lib/gitlab/token";
import { EpicsBrowser } from "@/components/epics/epics-browser";
import {
  getAuthenticatedUserId,
  getAuthenticatedRepoConfigById,
} from "@/lib/db/helpers";

interface EpicsPageProps {
  params: Promise<{ sourceType: string; repoId: string }>;
}

export default async function EpicsPage({ params }: EpicsPageProps) {
  const { sourceType, repoId } = await params;
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect("/login");

  const repoConfig = await getAuthenticatedRepoConfigById(userId, repoId);
  if (!repoConfig) return notFound();
  if (repoConfig.sourceType !== sourceType) return notFound();

  const gitlabToken = await getGitLabToken(userId);
  const project = await getCachedBmadProject(
    repoConfig,
    { gitlabToken: gitlabToken ?? undefined },
    userId,
  );
  if (!project) return notFound();

  const totalEpicProgress = project.epics.length > 0
    ? Math.round(
        project.epics.reduce((sum, e) => sum + e.progressPercent, 0) /
          project.epics.length
      )
    : 0;

  return (
    <EpicsBrowser
      epics={project.epics}
      stories={project.stories}
      totalEpics={project.epics.length}
      totalStories={project.totalStories}
      totalEpicProgress={totalEpicProgress}
    />
  );
}
