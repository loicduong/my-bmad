"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Gitlab,
  Globe as GlobeIcon,
  Loader2 as LoaderIcon,
  Lock as LockIcon,
  Plus as PlusIcon,
  Search as SearchIcon,
} from "lucide-react";
import {
  importGitLabGroup,
  listGitLabGroups,
  previewGitLabGroupBmadProjects,
} from "@/actions/repo-actions";
import type { GitLabBmadProject, GitLabGroup } from "@/lib/gitlab/client";
import type { GroupConfig, RepoConfig } from "@/lib/types";

interface AddRepoDialogProps {
  trigger?: React.ReactNode;
  importedRepos?: RepoConfig[];
  importedGroups?: GroupConfig[];
  gitlabEnabled?: boolean;
}

export function AddRepoDialog({
  trigger,
  importedGroups = [],
  gitlabEnabled = false,
}: AddRepoDialogProps) {
  const router = useRouter();
  const importedSet = useMemo(
    () => new Set(importedGroups.map((group) => group.fullPath)),
    [importedGroups],
  );

  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GitLabGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<GitLabGroup | null>(null);
  const [previewProjects, setPreviewProjects] = useState<GitLabBmadProject[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const fetchGroups = useCallback(async () => {
    if (!gitlabEnabled) return;
    setLoading(true);
    setError("");
    setGroups([]);
    setSelectedGroup(null);
    setPreviewProjects([]);

    const result = await listGitLabGroups();
    if (result.success) {
      setGroups(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [gitlabEnabled]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      fetchGroups();
    }
  }

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      (group) =>
        group.fullPath.toLowerCase().includes(q) ||
        group.description?.toLowerCase().includes(q),
    );
  }, [groups, search]);

  async function handlePreview(group: GitLabGroup) {
    setSelectedGroup(group);
    setPreviewProjects([]);
    setPreviewing(true);
    setError("");
    const result = await previewGitLabGroupBmadProjects({
      groupId: group.id,
      fullPath: group.fullPath,
    });
    if (result.success) {
      setPreviewProjects(result.data.projects);
    } else {
      setError(result.error);
    }
    setPreviewing(false);
  }

  async function handleImport() {
    if (!selectedGroup || previewProjects.length === 0) return;
    setImporting(true);
    setError("");
    const result = await importGitLabGroup({
      group: selectedGroup,
      projects: previewProjects,
    });
    setImporting(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-5 w-5">
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a GitLab group</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search for a group..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              disabled={loading}
            />
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <ScrollArea className="h-96">
              {loading ? (
                <div className="space-y-3 p-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                      <Skeleton className="h-8 w-8 rounded" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1 p-1">
                  {filteredGroups.length === 0 && !error && (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      {search ? "No group found" : "No group available"}
                    </p>
                  )}
                  {filteredGroups.map((group) => {
                    const isAlreadyImported = importedSet.has(group.fullPath);
                    const isSelected = selectedGroup?.fullPath === group.fullPath;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => handlePreview(group)}
                        disabled={previewing || importing || isAlreadyImported}
                        className="hover:bg-accent flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50 data-[selected=true]:border-primary"
                        data-selected={isSelected}
                      >
                        <Gitlab className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {group.fullPath}
                            </span>
                            {isAlreadyImported && (
                              <Badge variant="secondary" className="shrink-0 text-xs">
                                Imported
                              </Badge>
                            )}
                            {group.isPrivate ? (
                              <LockIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <GlobeIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                            )}
                          </div>
                          {group.description && (
                            <p className="text-muted-foreground mt-0.5 truncate text-xs">
                              {group.description}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">BMAD projects</p>
                  <p className="text-muted-foreground text-xs">
                    {selectedGroup ? selectedGroup.fullPath : "Select a group to preview"}
                  </p>
                </div>
                {previewing && <LoaderIcon className="h-4 w-4 animate-spin" />}
              </div>

              <ScrollArea className="mt-3 h-72">
                <div className="space-y-2">
                  {previewProjects.map((project) => (
                    <div key={project.fullName} className="rounded-lg border p-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {project.fullName}
                        </span>
                        <Badge variant={project.role === "general" ? "default" : "secondary"} className="text-xs">
                          {project.role}
                        </Badge>
                        {project.hasBmad && (
                          <Badge variant="outline" className="text-xs">
                            BMAD
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Branch: {project.defaultBranch}
                      </p>
                    </div>
                  ))}
                  {!previewing && selectedGroup && previewProjects.length === 0 && !error && (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      No BMAD projects found
                    </p>
                  )}
                </div>
              </ScrollArea>

              <Button
                className="mt-3 w-full"
                onClick={handleImport}
                disabled={!selectedGroup || previewProjects.length === 0 || importing}
              >
                {importing ? "Importing..." : "Import group"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
