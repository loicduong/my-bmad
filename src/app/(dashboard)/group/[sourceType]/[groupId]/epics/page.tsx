import { redirect, notFound } from "next/navigation";
import { getCachedBmadWorkspace } from "@/lib/bmad/cached-workspace";
import { getGitLabToken } from "@/lib/gitlab/token";
import { EpicsBrowser } from "@/components/epics/epics-browser";
import {
  getAuthenticatedUserId,
  getAuthenticatedGroupConfigById,
} from "@/lib/db/helpers";

interface EpicsPageProps {
  params: Promise<{ sourceType: string; groupId: string }>;
}

export default async function GroupEpicsPage({ params }: EpicsPageProps) {
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

  const totalEpicProgress = project.epics.length > 0
    ? Math.round(
        project.epics.reduce((sum, e) => sum + e.progressPercent, 0) /
          project.epics.length,
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
