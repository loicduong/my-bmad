import { redirect, notFound } from "next/navigation";
import { getCachedBmadWorkspace } from "@/lib/bmad/cached-workspace";
import { getGitLabToken } from "@/lib/gitlab/token";
import { StoriesView } from "@/components/stories/stories-view";
import {
  getAuthenticatedUserId,
  getAuthenticatedGroupConfigById,
} from "@/lib/db/helpers";

interface StoriesPageProps {
  params: Promise<{ sourceType: string; groupId: string }>;
}

export default async function GroupStoriesPage({ params }: StoriesPageProps) {
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

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stories</h1>
        <p className="text-muted-foreground mt-1">
          {project.stories.length} stories across {project.epics.length} epics
        </p>
      </div>
      <StoriesView stories={project.stories} epics={project.epics} />
    </div>
  );
}
