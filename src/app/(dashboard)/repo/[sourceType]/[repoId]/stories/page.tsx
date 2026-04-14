import { redirect, notFound } from "next/navigation";
import { getCachedBmadProject } from "@/lib/bmad/cached-project";
import { getGitLabToken } from "@/lib/gitlab/token";
import { StoriesView } from "@/components/stories/stories-view";
import {
  getAuthenticatedUserId,
  getAuthenticatedRepoConfigById,
} from "@/lib/db/helpers";

interface StoriesPageProps {
  params: Promise<{ sourceType: string; repoId: string }>;
}

export default async function StoriesPage({ params }: StoriesPageProps) {
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

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stories</h1>
        <p className="text-muted-foreground mt-1">
          {project.stories.length} stories across {project.epics.length}{" "}
          epics
        </p>
      </div>
      <StoriesView stories={project.stories} epics={project.epics} />
    </div>
  );
}
