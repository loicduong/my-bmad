import { redirect, notFound } from "next/navigation";
import { DocsBrowser } from "@/components/docs/docs-browser";
import { fetchGroupBmadFiles } from "@/actions/repo-actions";
import {
  getAuthenticatedUserId,
  getAuthenticatedGroupConfigById,
} from "@/lib/db/helpers";

interface DocsPageProps {
  params: Promise<{ sourceType: string; groupId: string }>;
  searchParams: Promise<{ file?: string }>;
}

export default async function GroupDocsPage({
  params,
  searchParams,
}: DocsPageProps) {
  const { sourceType, groupId } = await params;
  const { file: initialFile } = await searchParams;
  const userId = await getAuthenticatedUserId();
  if (!userId) redirect("/login");

  const groupConfig = await getAuthenticatedGroupConfigById(userId, groupId);
  if (!groupConfig) return notFound();
  if (groupConfig.sourceType !== sourceType) return notFound();

  const result = await fetchGroupBmadFiles({ groupId: groupConfig.id });

  if (!result.success) {
    return (
      <div className="space-y-8 pb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground mt-1">
            Browse workspace files
          </p>
        </div>
        <div
          className="flex h-64 items-center justify-center text-muted-foreground"
          role="alert"
        >
          <p>{result.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        <p className="text-muted-foreground mt-1">
          Browse workspace files
        </p>
      </div>
      <DocsBrowser
        fileTree={result.data.fileTree}
        docsTree={result.data.docsTree}
        bmadCoreTree={result.data.bmadCoreTree}
        repoId={groupConfig.repos[0]?.id ?? groupConfig.id}
        groupId={groupConfig.id}
        initialSelectedFile={initialFile}
      />
    </div>
  );
}
