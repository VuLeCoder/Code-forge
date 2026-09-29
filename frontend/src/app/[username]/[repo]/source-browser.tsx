"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { BranchBrowser } from "./branch-browser";
import { CommitBrowser } from "./commit-browser";
import styles from "./repository.module.css";

export function SourceBrowser({ endpoint, children }: { endpoint: string; children: ReactNode }) {
  const query = useSearchParams();
  const pathname = usePathname();
  const view = query.get("view");
  const params = new URLSearchParams();
  if (query.has("ref")) params.set("ref", query.get("ref")!);
  const source = `${pathname}${params.size ? `?${params}` : ""}`;
  params.set("view", "commits");
  return <>
    <nav className={styles.sourceTabs} aria-label="Nội dung repository">
      <Link href={source} aria-current={view !== "commits" && view !== "commit" ? "page" : undefined}>Mã nguồn</Link>
      <Link href={`${pathname}?${params}`} aria-current={view === "commits" || view === "commit" ? "page" : undefined}>Lịch sử commit</Link>
    </nav>
    {view === "commit" ? <CommitBrowser endpoint={endpoint} detail /> : <BranchBrowser endpoint={endpoint}>{children}</BranchBrowser>}
  </>;
}
