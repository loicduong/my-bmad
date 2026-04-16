-- CreateTable
CREATE TABLE "bmad_groups" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'gitlab',
    "gitlabGroupId" INTEGER NOT NULL,
    "fullPath" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bmad_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "fullPath" TEXT,
ADD COLUMN IF NOT EXISTS "localPath" TEXT,
ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'member',
ADD COLUMN IF NOT EXISTS "groupId" TEXT;

-- Backfill project full paths for existing GitLab rows.
UPDATE "repos"
SET "fullPath" = CONCAT("owner", '/', "name")
WHERE "fullPath" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "bmad_groups_userId_sourceType_fullPath_key" ON "bmad_groups"("userId", "sourceType", "fullPath");

-- CreateIndex
CREATE INDEX "bmad_groups_userId_idx" ON "bmad_groups"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "repos_userId_sourceType_fullPath_key" ON "repos"("userId", "sourceType", "fullPath");

-- CreateIndex
CREATE INDEX "repos_groupId_idx" ON "repos"("groupId");

-- AddForeignKey
ALTER TABLE "bmad_groups" ADD CONSTRAINT "bmad_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repos" ADD CONSTRAINT "repos_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "bmad_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
