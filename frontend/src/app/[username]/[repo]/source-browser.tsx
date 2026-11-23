"use client";

import { useSearchParams } from "next/navigation";
import type { RepositorySummary } from "@/lib/repositories";
import type { ReactNode } from "react";
import { BranchBrowser } from "./branch-browser";
import { CommitBrowser } from "./commit-browser";

export function SourceBrowser({ endpoint, children, repository }: { endpoint: string; children: ReactNode; repository: RepositorySummary }) {
  const query = useSearchParams();
  const view = query.get("view");
  return <>
    {view === "commit" ? <CommitBrowser endpoint={endpoint} detail /> : <BranchBrowser repository={repository} endpoint={endpoint}>{children}</BranchBrowser>}
  </>;
}
