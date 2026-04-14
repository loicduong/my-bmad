/**
 * Utility functions for Next.js cache tags used in revalidateTag().
 * These tags allow granular cache invalidation across the app.
 */

/** Tag for an entire repository's tree cache. */
export function repoTag(sourceType: string, fullName: string) {
  return `repo:${sourceType}:${fullName}`;
}

/** Tag for a specific file's content cache. */
export function fileTag(sourceType: string, fullName: string, path: string) {
  return `file:${sourceType}:${fullName}:${path}`;
}
