import "server-only";

import { headers } from "next/headers";
import { withBackendClientIp } from "@/lib/backend-client-ip";
import type { RepositorySummary } from "@/lib/repositories";

type RepositoryListResponse = { repositories: RepositorySummary[]; hasMore: boolean };

export type RepositoryListResult =
  | { status: "success"; data: RepositoryListResponse }
  | { status: "error" };

export function repositorySearchQuery(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

export function repositorySearchPage(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,2}$/.test(value) ? Number(value) : 1;
}

function isRepositorySummary(value: unknown): value is RepositorySummary {
  if (!value || typeof value !== "object") return false;
  const repository = value as Partial<RepositorySummary>;
  return typeof repository.id === "string"
    && typeof repository.name === "string"
    && typeof repository.owner?.username === "string"
    && (repository.description === null || typeof repository.description === "string")
    && (repository.visibility === "PUBLIC" || repository.visibility === "PRIVATE")
    && typeof repository.updatedAt === "string"
    && typeof repository.permissions?.canRead === "boolean"
    && typeof repository.permissions?.canManage === "boolean";
}

function isRepositoryListResponse(value: unknown): value is RepositoryListResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<RepositoryListResponse>;
  return Array.isArray(result.repositories)
    && result.repositories.every(isRepositorySummary)
    && typeof result.hasMore === "boolean";
}

export async function loadPublicRepositories(query: string, page: number): Promise<RepositoryListResult> {
  try {
    const search = new URLSearchParams({ page: String(page) });
    if (query) search.set("q", query);
    const configuredTimeout = Number(process.env.HOME_REPOSITORY_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10_000;
    const response = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repositories?${search}`, {
      headers: withBackendClientIp(await headers()),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      const body: unknown = await response.json();
      if (isRepositoryListResponse(body)) return { status: "success", data: body };
    }
  } catch {
    // The caller renders an explicit, retryable unavailable state.
  }
  return { status: "error" };
}
