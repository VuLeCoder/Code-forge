CREATE TABLE "branch_updates" (
"id" UUID NOT NULL, "repository_id" UUID NOT NULL, "storage_generation" INTEGER NOT NULL,
"branch" VARCHAR(255) NOT NULL, "sha" VARCHAR(64) NOT NULL, "actor_id" UUID NOT NULL,
"kind" VARCHAR(16) NOT NULL, "operation_id" UUID NOT NULL,
"created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "branch_updates_pkey" PRIMARY KEY ("id"),
CONSTRAINT "branch_updates_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE UNIQUE INDEX "branch_updates_operation_id_branch_key" ON "branch_updates"("operation_id", "branch");
CREATE INDEX "branch_updates_repository_id_storage_generation_branch_sha_idx" ON "branch_updates"("repository_id", "storage_generation", "branch", "sha");
