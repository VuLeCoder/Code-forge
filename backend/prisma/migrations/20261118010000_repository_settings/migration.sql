ALTER TABLE "repositories" ADD COLUMN "protect_default_branch" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "repository_members" ADD COLUMN "can_merge" BOOLEAN NOT NULL DEFAULT false;
