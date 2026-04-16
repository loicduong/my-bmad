import { RepoCard } from "./repo-card";
import { AddRepoCard } from "./add-repo-card";
import { StaggeredList, StaggeredItem } from "@/components/shared/staggered-list";
import { getGroupHref } from "@/lib/repo-routes";
import type { BmadWorkspace } from "@/lib/bmad/types";
import type { GroupConfig } from "@/lib/types";

interface ReposGridProps {
  projects: BmadWorkspace[];
  groups: GroupConfig[];
  gitlabEnabled?: boolean;
}

export function ReposGrid({ projects, groups, gitlabEnabled }: ReposGridProps) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          No group imported
        </p>
        <p className="mt-2 text-sm text-muted-foreground mb-4">
          Add a BMAD GitLab group to get started.
        </p>
        <AddRepoCard gitlabEnabled={gitlabEnabled} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          Failed to load projects
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Data from your {groups.length} group{groups.length > 1 ? "s" : ""} could not be fetched. Check your connection or try again.
        </p>
      </div>
    );
  }

  const groupMap = new Map(groups.map((group) => [group.id, group]));

  return (
    <StaggeredList className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" initialDelay={0.2} staggerDelay={0.08}>
      {projects.map((project) => (
        <StaggeredItem key={project.id}>
          <RepoCard
            project={project}
            description={groupMap.get(project.id)?.description ?? null}
            sourceType={project.sourceType}
            repoId={project.id}
            href={getGroupHref(project.sourceType, project.id)}
            subtitle={project.groupFullPath}
            reposCount={project.reposCount}
          />
        </StaggeredItem>
      ))}
      <StaggeredItem>
        <AddRepoCard gitlabEnabled={gitlabEnabled} />
      </StaggeredItem>
    </StaggeredList>
  );
}
