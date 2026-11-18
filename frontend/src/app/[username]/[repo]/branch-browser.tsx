"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./repository.module.css";
import { TreeBrowser } from "./tree-browser";
import type { RepositorySummary } from "@/lib/repositories";
import { CloneDialog } from "./clone-dialog";
import { RepositoryOverview } from "./repository-overview";
import { RepositoryIcon } from "./repository-icon";
import { FileFinder } from "./file-finder";
import { CommitFilters } from "./commit-filters";
import { CommitBrowser } from "./commit-browser";

type Branch = { name: string; commitSha: string; isDefault: boolean };
type Branches = {
  branches: Branch[];
  selectedBranch: Branch | null;
  defaultBranch: string;
  storageState: string;
};

export function BranchBrowser({
  endpoint,
  children,
  repository,
}: {
  endpoint: string;
  repository: RepositorySummary;
  children: ReactNode;
}) {
  const query = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const ref = query.get("ref");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("");
  const branchesMenu = useRef<HTMLDetailsElement>(null);
  const key = JSON.stringify([endpoint, ref, user?.id, attempt]);
  const [result, setResult] = useState<{
    key: string;
    data?: Branches;
    error?: string;
  }>({ key: "" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    sessionFetch(
      `${endpoint}/branches${ref === null ? "" : `?ref=${encodeURIComponent(ref)}`}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.code === "REF_NOT_FOUND"
              ? "Branch không tồn tại hoặc đã bị xóa."
              : body.error?.code === "INVALID_REF"
                ? "Tên branch không hợp lệ."
                : response.status === 404
                  ? "Repository không tồn tại hoặc bạn không có quyền xem."
                  : "Chưa thể tải danh sách branch.",
          );
        if (active) setResult({ key, data: body });
      })
      .catch((error) => {
        if (active)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : "Không thể tải branch.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint, ref, key]);

  function select(value: string) {
    const next = new URLSearchParams(query.toString());
    next.delete("path");
    if (next.get("view") !== "commits") next.delete("view");
    next.delete("page");
    next.delete("snapshot");
    next.delete("sha");
    if (value) next.set("ref", value);
    else next.delete("ref");
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  if (result.key !== key) return <><CloneDialog repository={repository} /><p role="status">Đang tải branch…</p></>;
  if (!result.data)
    return (
      <section className={styles.empty}>
        <CloneDialog repository={repository} />
        <p role="alert">{result.error}</p>
        <button
          className="button buttonSecondary"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Tải lại branch
        </button>
        {ref !== null && (
          <button className="button buttonSecondary" onClick={() => select("")}>
            Về nhánh mặc định
          </button>
        )}
      </section>
    );
  const data = result.data;
  const history = query.get("view") === "commits";

  return (
    <>
      {history && <h2 className={styles.historyHeading}>Lịch sử commit</h2>}
      <div className={styles.repoToolbar}>
        <details ref={branchesMenu} className={styles.branchPicker}><summary aria-label="Branch" aria-disabled={!data.branches.length} data-branch={data.selectedBranch?.name ?? ""}><RepositoryIcon name="branch" /><span>{data.selectedBranch?.name ?? "Chưa có nhánh"}</span><RepositoryIcon name="chevron" /></summary>
          <div><label>Lọc nhánh<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
          {data.branches.filter(branch => branch.name.toLowerCase().includes(filter.toLowerCase())).map(branch => <button key={branch.name} type="button" onClick={() => { select(branch.name); if (branchesMenu.current) branchesMenu.current.open = false; }}>{branch.name}{branch.isDefault ? " (mặc định)" : ""}</button>)}</div>
        </details>
        {history && <CommitFilters endpoint={endpoint} />}
        {!history && <><button type="button" className={styles.branchCount} onClick={() => { if (branchesMenu.current) branchesMenu.current.open = !branchesMenu.current.open; }}><RepositoryIcon name="branch" /><span><strong>{data.branches.length}</strong> nhánh</span></button>
        <FileFinder endpoint={endpoint} refName={data.selectedBranch?.name ?? null} />
        <CloneDialog repository={repository} /></>}
      </div>
      {!history && data.selectedBranch && <RepositoryOverview endpoint={endpoint} refName={data.selectedBranch.name} />}
      {query.get("view") === "commits" ? (
        <CommitBrowser endpoint={endpoint} />
      ) : data.selectedBranch || query.get("path") ? (
        <TreeBrowser
          endpoint={endpoint}
          refName={data.selectedBranch?.name ?? null}
        />
      ) : !data.branches.length ? (
        children
      ) : (
        <section className={styles.empty}>
          <h2>Nhánh mặc định chưa có commit</h2>
          <p>Chọn một branch hiện có để xem thông tin.</p>
        </section>
      )}
    </>
  );
}
