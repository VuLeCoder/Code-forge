"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./repository.module.css";
import { TreeBrowser } from "./tree-browser";
import { CommitBrowser } from "./commit-browser";

type Branch = { name: string; commitSha: string; isDefault: boolean };
type Branches = {
  branches: Branch[];
  selectedBranch: Branch | null;
  defaultBranch: string;
  storageState: string;
};

function GitBranchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={styles.branchIcon}
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

export function BranchBrowser({
  endpoint,
  children,
}: {
  endpoint: string;
  children: ReactNode;
}) {
  const query = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const ref = query.get("ref");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const key = JSON.stringify([endpoint, ref, user?.id, attempt]);
  const [result, setResult] = useState<{
    key: string;
    data?: Branches;
    error?: string;
  }>({ key: "" });

  function copySha(sha: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(sha).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

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

  if (result.key !== key) return <p role="status">Đang tải branch…</p>;
  if (!result.data)
    return (
      <section className={styles.empty}>
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

  return (
    <>
      <div className={styles.branchBar}>
        <div className={styles.branchSelectGroup}>
          <label htmlFor="branch-select" className={styles.branchLabel}>
            <GitBranchIcon />
            <span>Branch</span>
          </label>
          <select
            id="branch-select"
            value={data.selectedBranch?.name ?? ""}
            disabled={!data.branches.length}
            onChange={(event) => select(event.target.value)}
          >
            {!data.selectedBranch && (
              <option value="">
                {data.branches.length
                  ? "Nhánh mặc định chưa có commit"
                  : "Chưa có branch"}
              </option>
            )}
            {data.branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
                {branch.isDefault ? " (mặc định)" : ""}
              </option>
            ))}
          </select>
        </div>
        {data.selectedBranch && (
          <div className={styles.commitBadgeGroup}>
            <code
              title={data.selectedBranch.commitSha}
              className={styles.commitCode}
            >
              {data.selectedBranch.commitSha.slice(0, 12)}
            </code>
            <button
              type="button"
              className={styles.copyShaBtn}
              onClick={() => copySha(data.selectedBranch!.commitSha)}
              title={copied ? "Đã sao chép!" : "Sao chép SHA"}
              aria-label="Sao chép SHA"
            >
              {copied ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
                  <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
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
