CREATE TYPE "RepositoryVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "RepositoryStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DELETED');

CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000),
    "visibility" "RepositoryVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "RepositoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "default_branch" VARCHAR(255) NOT NULL DEFAULT 'main',
    "storage_key" VARCHAR(255) NOT NULL,
    "storage_generation" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "purge_after" TIMESTAMPTZ(3),
    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "repositories_normalized_name_check" CHECK ("normalized_name" = lower("name"))
);

CREATE UNIQUE INDEX "repositories_storage_key_key" ON "repositories"("storage_key");
CREATE UNIQUE INDEX "repositories_owner_id_normalized_name_key" ON "repositories"("owner_id", "normalized_name");
CREATE INDEX "repositories_owner_id_status_created_at_idx" ON "repositories"("owner_id", "status", "created_at");
CREATE INDEX "repositories_visibility_status_created_at_idx" ON "repositories"("visibility", "status", "created_at");
CREATE INDEX "repositories_status_purge_after_idx" ON "repositories"("status", "purge_after");

ALTER TABLE "repositories" ADD CONSTRAINT "repositories_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
