"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listRepoBranches, updateRepoBranch } from "@/actions/repo-actions";
import type { RepoConfig } from "@/lib/types";

interface GroupSettingsModalProps {
  displayName: string;
  repos: RepoConfig[];
}

export function GroupSettingsModal({ displayName, repos }: GroupSettingsModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchesByRepo, setBranchesByRepo] = useState<Record<string, string[]>>({});
  const [selectedByRepo, setSelectedByRepo] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenChange(nextOpen: boolean) {
    if (saving) return;
    setOpen(nextOpen);
    setError(null);

    if (!nextOpen) return;

    setLoading(true);
    setSelectedByRepo(Object.fromEntries(repos.map((repo) => [repo.id, repo.branch])));
    const nextBranches: Record<string, string[]> = {};
    for (const repo of repos) {
      const result = await listRepoBranches({ repoId: repo.id });
      if (result.success) {
        nextBranches[repo.id] = result.data;
      } else {
        nextBranches[repo.id] = [repo.branch];
        setError(result.error);
      }
    }
    setBranchesByRepo(nextBranches);
    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    for (const repo of repos) {
      const branch = selectedByRepo[repo.id];
      if (!branch || branch === repo.branch) continue;
      const result = await updateRepoBranch({ repoId: repo.id, branch });
      if (!result.success) {
        setError(result.error);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  const hasChanges = repos.some(
    (repo) => selectedByRepo[repo.id] && selectedByRepo[repo.id] !== repo.branch,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label="Workspace settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>
            Configure tracked branches for <strong>{displayName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 space-y-3 overflow-y-auto py-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading branches...
            </div>
          ) : (
            repos.map((repo) => (
              <div key={repo.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_220px] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{repo.fullPath ?? `${repo.owner}/${repo.name}`}</p>
                  <p className="text-xs text-muted-foreground">{repo.role}</p>
                </div>
                <Select
                  value={selectedByRepo[repo.id] ?? repo.branch}
                  onValueChange={(branch) =>
                    setSelectedByRepo((current) => ({ ...current, [repo.id]: branch }))
                  }
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {(branchesByRepo[repo.id] ?? [repo.branch]).map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || !hasChanges}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
