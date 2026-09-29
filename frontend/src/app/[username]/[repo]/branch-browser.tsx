"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./repository.module.css";
import { TreeBrowser } from "./tree-browser";
import { CommitBrowser } from "./commit-browser";

type Branch = { name: string; commitSha: string; isDefault: boolean };
type Branches = { branches: Branch[]; selectedBranch: Branch | null; defaultBranch: string; storageState: string };

export function BranchBrowser({ endpoint, children }: { endpoint: string; children: ReactNode }) {
  const query = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const ref = query.get("ref");
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([endpoint, ref, user?.id, attempt]);
  const [result, setResult] = useState<{ key: string; data?: Branches; error?: string }>({ key: "" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    sessionFetch(`${endpoint}/branches${ref === null ? "" : `?ref=${encodeURIComponent(ref)}`}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.code === "REF_NOT_FOUND" ? "Branch không tồn tại hoặc đã bị xóa." : body.error?.code === "INVALID_REF" ? "Tên branch không hợp lệ." : response.status === 404 ? "Repository không tồn tại hoặc bạn không có quyền xem." : "Chưa thể tải danh sách branch.");
        if (active) setResult({ key, data: body });
      }).catch((error) => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Không thể tải branch." }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, ref, key]);

  function select(value: string) {
    const next = new URLSearchParams(query.toString());
    next.delete("path");
    if (next.get("view") !== "commits") next.delete("view");
    next.delete("page");
    next.delete("snapshot");
    next.delete("sha");
    if (value) next.set("ref", value); else next.delete("ref");
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }
  if (result.key !== key) return <p role="status">Đang tải branch…</p>;
  if (!result.data) return <section className={styles.empty}><p role="alert">{result.error}</p><button className="button buttonSecondary" onClick={() => setAttempt((n) => n + 1)}>Tải lại branch</button>{ref !== null && <button className="button buttonSecondary" onClick={() => select("")}>Về nhánh mặc định</button>}</section>;
  const data = result.data;
  return <>
    <div className={styles.branchBar}>
      <label htmlFor="branch-select">Branch</label>
      <select id="branch-select" value={data.selectedBranch?.name ?? ""} disabled={!data.branches.length} onChange={(event) => select(event.target.value)}>
        {!data.selectedBranch && <option value="">{data.branches.length ? "Nhánh mặc định chưa có commit" : "Chưa có branch"}</option>}
        {data.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.isDefault ? " (mặc định)" : ""}</option>)}
      </select>
      {data.selectedBranch && <code title={data.selectedBranch.commitSha}>{data.selectedBranch.commitSha.slice(0, 12)}</code>}
    </div>
    {query.get("view") === "commits" ? <CommitBrowser endpoint={endpoint} /> : data.selectedBranch || query.get("path") ? <TreeBrowser endpoint={endpoint} refName={data.selectedBranch?.name ?? null} /> : !data.branches.length ? children : <section className={styles.empty}><h2>Nhánh mặc định chưa có commit</h2><p>Chọn một branch hiện có để xem thông tin.</p></section>}
  </>;
}
