"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { refreshBmadGroup, refreshRepoData } from "@/actions/repo-actions";

interface RefreshRepoButtonProps {
  repoId?: string;
  groupId?: string;
}

function formatFileCount(count: number): string {
  if (count === 0) return "No BMAD files detected.";
  return `${count} BMAD file${count > 1 ? "s" : ""} detected.`;
}

export function RefreshRepoButton({ repoId, groupId }: RefreshRepoButtonProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    totalFiles?: number;
    reposCount?: number;
    error?: string;
    code?: string;
  } | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = groupId
        ? await refreshBmadGroup({ groupId })
        : await refreshRepoData({ repoId: repoId! });
      if (res.success) {
        setResult({
          success: true,
          totalFiles: "totalFiles" in res.data ? res.data.totalFiles : undefined,
          reposCount: "reposCount" in res.data ? res.data.reposCount : undefined,
        });
      } else {
        setResult({ success: false, error: res.error, code: res.code });
      }
      setDialogOpen(true);
      if (res.success) {
        router.refresh();
      }
    } catch {
      setResult({ success: false, error: "Unexpected error" });
      setDialogOpen(true);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground hover:text-foreground"
        aria-label="Refresh data"
        onClick={handleRefresh}
        disabled={refreshing}
      >
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </Button>

      <Dialog open={dialogOpen} onOpenChange={(open) => {
        if (!refreshing) setDialogOpen(open);
      }}>
        <DialogContent>
          {result?.success === true ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <DialogTitle>Refresh successful</DialogTitle>
                </div>
                <DialogDescription>
                  {result.reposCount
                    ? `${result.reposCount} repo${result.reposCount > 1 ? "s" : ""} refreshed.`
                    : formatFileCount(result.totalFiles ?? 0)}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => setDialogOpen(false)}>OK</Button>
              </DialogFooter>
            </>
          ) : result?.success === false ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-destructive" />
                  <DialogTitle>Refresh failed</DialogTitle>
                </div>
                <DialogDescription>
                  <span role="alert">
                    {result.code === "RATE_LIMITED"
                      ? "Provider rate limit reached. Cached data is displayed."
                      : result.error || "An unknown error occurred."}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Close</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
