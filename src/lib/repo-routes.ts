import type { SourceType } from "@/lib/types";

export function getRepoHref(
  sourceType: SourceType,
  repoId: string,
  segment?: string,
): string {
  const base = `/repo/${sourceType}/${encodeURIComponent(repoId)}`;
  return segment ? `${base}/${segment}` : base;
}

export function getGroupHref(
  sourceType: SourceType,
  groupId: string,
  segment?: string,
): string {
  const base = `/group/${sourceType}/${encodeURIComponent(groupId)}`;
  return segment ? `${base}/${segment}` : base;
}
