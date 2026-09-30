CREATE TYPE "RepositoryMemberRole" AS ENUM ('READ', 'WRITE');
CREATE TABLE "repository_members" (
  "repository_id" UUID NOT NULL REFERENCES "repositories"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "RepositoryMemberRole" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("repository_id", "user_id")
);
CREATE INDEX "repository_members_user_id_idx" ON "repository_members"("user_id");
CREATE TABLE "personal_access_tokens" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" VARCHAR(100) NOT NULL,
  "token_prefix" VARCHAR(20) NOT NULL UNIQUE,
  "token_hash" VARCHAR(64) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_used_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (cardinality("scopes") BETWEEN 1 AND 2 AND "scopes" <@ ARRAY['repo:read', 'repo:write']::TEXT[])
);
CREATE INDEX "personal_access_tokens_user_id_created_at_idx" ON "personal_access_tokens"("user_id", "created_at");
CREATE TABLE "audit_logs" (
  "id" UUID PRIMARY KEY,
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(80) NOT NULL,
  "target_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
