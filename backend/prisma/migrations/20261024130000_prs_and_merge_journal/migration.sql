CREATE TYPE "PullRequestStatus" AS ENUM ('OPEN', 'CLOSED', 'MERGED');
CREATE TYPE "MergeOperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'NEEDS_RECONCILIATION');

ALTER TABLE "audit_logs" ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE "pull_requests" (
  "id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "author_id" UUID NOT NULL,
  "title" VARCHAR(256) NOT NULL,
  "description" VARCHAR(10000),
  "source_branch" VARCHAR(255) NOT NULL,
  "target_branch" VARCHAR(255) NOT NULL,
  "status" "PullRequestStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "storage_generation" INTEGER NOT NULL,
  "source_sha" VARCHAR(64) NOT NULL,
  "target_sha" VARCHAR(64) NOT NULL,
  "merged_by_id" UUID,
  "merged_at" TIMESTAMPTZ(3),
  "merge_commit_sha" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pull_requests_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pull_requests_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pull_requests_merged_by_id_fkey" FOREIGN KEY ("merged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pull_requests_number_check" CHECK ("number" > 0),
  CONSTRAINT "pull_requests_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "pull_requests_repository_id_number_key" ON "pull_requests"("repository_id", "number");
CREATE INDEX "pull_requests_repository_id_status_number_idx" ON "pull_requests"("repository_id", "status", "number");
CREATE INDEX "pull_requests_author_id_created_at_idx" ON "pull_requests"("author_id", "created_at");
CREATE UNIQUE INDEX "pull_requests_open_pair_unique_idx" ON "pull_requests"("repository_id", "source_branch", "target_branch") WHERE "status" = 'OPEN';

CREATE TABLE "pull_request_merge_operations" (
  "operation_id" UUID NOT NULL,
  "repository_id" UUID NOT NULL,
  "pull_request_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "status" "MergeOperationStatus" NOT NULL DEFAULT 'PENDING',
  "storage_generation" INTEGER NOT NULL,
  "expected_source_sha" VARCHAR(64) NOT NULL,
  "expected_target_sha" VARCHAR(64) NOT NULL,
  "old_target_sha" VARCHAR(64) NOT NULL,
  "candidate_sha" VARCHAR(64),
  "resulting_sha" VARCHAR(64),
  "error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "pull_request_merge_operations_pkey" PRIMARY KEY ("operation_id"),
  CONSTRAINT "pull_request_merge_operations_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "pull_request_merge_operations_pull_request_id_fkey" FOREIGN KEY ("pull_request_id") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "pull_request_merge_operations_status_updated_at_idx" ON "pull_request_merge_operations"("status", "updated_at");
CREATE INDEX "pull_request_merge_operations_repository_id_status_idx" ON "pull_request_merge_operations"("repository_id", "status");
