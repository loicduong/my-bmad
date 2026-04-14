-- DropIndex
DROP INDEX IF EXISTS "repos_userId_owner_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "repos_userId_sourceType_owner_name_key" ON "repos"("userId", "sourceType", "owner", "name");
