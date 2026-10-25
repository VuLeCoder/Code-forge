CREATE TYPE "GitPushOperationStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'FAILED',
  'NEEDS_RECONCILIATION'
);

CREATE TABLE "git_push_operations" (
  "operation_id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "status" "GitPushOperationStatus" NOT NULL DEFAULT 'PENDING',
  "storage_generation" INTEGER NOT NULL,
  "before_refs" JSONB,
  "changed_ref_count" INTEGER,
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "git_push_operations_pkey" PRIMARY KEY ("operation_id"),
  CONSTRAINT "git_push_operations_repository_id_fkey"
    FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "git_push_operations_changed_ref_count_check"
    CHECK ("changed_ref_count" IS NULL OR "changed_ref_count" >= 0)
);

CREATE INDEX "git_push_operations_status_updated_at_idx"
  ON "git_push_operations"("status", "updated_at");

CREATE INDEX "git_push_operations_repository_id_status_idx"
  ON "git_push_operations"("repository_id", "status");
