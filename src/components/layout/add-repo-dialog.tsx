"use client";

import { useState, useMemo, useCallback } from "react";
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
  Search as SearchIcon,
  Lock as LockIcon,
  Globe as GlobeIcon,
  FolderGit2 as GitIcon,
  Plus as PlusIcon,
  Loader2 as LoaderIcon,
} from "lucide-react";
import {
  listGitLabRepos,
  detectGitLabBmadRepos,
  importGitLabRepo,
} from "@/actions/repo-actions";
import type { GitLabRepo } from "@/lib/gitlab/client";
import type { SourceType } from "@/lib/types";

interface AddRepoDialogProps {
  trigger?: React.ReactNode;
  importedRepos?: { sourceType: SourceType; owner: string; name: string }[];
  gitlabEnabled?: boolean;
}

export function AddRepoDialog({
  trigger,
  importedRepos = [],
  gitlabEnabled = false,
}: AddRepoDialogProps) {
  const importedSet = useMemo(
    () => new Set(importedRepos.map((r) => `${r.sourceType}:${r.owner}/${r.name}`)),
    [importedRepos]
  );
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gitlabRepos, setGitLabRepos] = useState<GitLabRepo[]>([]);
  const [gitlabLoading, setGitLabLoading] = useState(false);
  const [gitlabDetecting, setGitLabDetecting] = useState(false);
  const [gitlabError, setGitLabError] = useState("");
  const [gitlabSearch, setGitLabSearch] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [gitlabImportError, setGitLabImportError] = useState("");

  const fetchGitLabRepos = useCallback(async () => {
    if (!gitlabEnabled) return;
    setGitLabLoading(true);
    setGitLabError("");
    setGitLabRepos([]);
    setGitLabSearch("");
    setGitLabDetecting(false);

    const result = await listGitLabRepos();
    if (!result.success) {
      setGitLabError(result.error);
      setGitLabLoading(false);
      return;
    }

    setGitLabRepos(result.data);
    setGitLabLoading(false);

    if (result.data.length > 0) {
      setGitLabDetecting(true);
      const ids = result.data.map((r) => ({
        fullName: r.fullName,
        owner: r.owner,
        name: r.name,
        defaultBranch: r.defaultBranch,
      }));

      const bmadResult = await detectGitLabBmadRepos(ids);
      if (bmadResult.success) {
        setGitLabRepos((prev) => {
          const updated = prev.map((r) => ({
            ...r,
            hasBmad: bmadResult.data[r.fullName] ?? false,
          }));
          updated.sort((a, b) => {
            if (a.hasBmad !== b.hasBmad) return a.hasBmad ? -1 : 1;
            return (
              new Date(b.updatedAt).getTime() -
              new Date(a.updatedAt).getTime()
            );
          });
          return updated;
        });
      }
      setGitLabDetecting(false);
    }
  }, [gitlabEnabled]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      fetchGitLabRepos();
    }
  }

  const gitlabFiltered = useMemo(() => {
    if (!gitlabSearch.trim()) return gitlabRepos;
    const q = gitlabSearch.toLowerCase();
    return gitlabRepos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
    );
  }, [gitlabRepos, gitlabSearch]);

  async function handleSelectGitLabRepo(repo: GitLabRepo) {
    setImporting(repo.fullName);
    setGitLabImportError("");

    const result = await importGitLabRepo({
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      fullName: repo.fullName,
    });

    if (result.success) {
      setOpen(false);
      router.refresh();
    } else {
      setGitLabImportError(result.error);
    }
    setImporting(null);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a GitLab project</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder="Search for a repository..."
              value={gitlabSearch}
              onChange={(e) => setGitLabSearch(e.target.value)}
              className="pl-9"
              disabled={gitlabLoading}
            />
          </div>

          {gitlabError && <p className="text-destructive text-sm">{gitlabError}</p>}
          {gitlabImportError && <p className="text-destructive text-sm">{gitlabImportError}</p>}
          {gitlabDetecting && (
            <p className="text-muted-foreground text-xs animate-pulse">
              Detecting BMAD files...
            </p>
          )}

          <ScrollArea className="h-80">
            {gitlabLoading ? (
              <div className="space-y-3 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
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
                {gitlabFiltered.length === 0 && !gitlabError && (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {gitlabSearch ? "No repository found" : "No repository available (verify your PAT)"}
                  </p>
                )}
                {gitlabFiltered.map((repo) => {
                  const isImporting = importing === repo.fullName;
                  const isAlreadyImported = importedSet.has(
                    `gitlab:${repo.owner}/${repo.name}`
                  );
                  const isDisabled = importing !== null || isAlreadyImported;

                  return (
                    <button
                      key={repo.id}
                      type="button"
                      onClick={() => handleSelectGitLabRepo(repo)}
                      disabled={isDisabled}
                      className="hover:bg-accent flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
                    >
                      {isImporting ? (
                        <LoaderIcon className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0 animate-spin" />
                      ) : (
                        <GitIcon className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {repo.fullName}
                          </span>
                          {isAlreadyImported && (
                            <Badge variant="secondary" className="shrink-0 text-xs">
                              Imported
                            </Badge>
                          )}
                          {repo.hasBmad && !isAlreadyImported && (
                            <Badge variant="default" className="shrink-0 text-xs">
                              BMAD
                            </Badge>
                          )}
                          {repo.isPrivate ? (
                            <LockIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <GlobeIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-muted-foreground mt-0.5 truncate text-xs [text-wrap:auto]">
                            {repo.description}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
