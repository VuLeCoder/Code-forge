"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sessionFetch } from "@/lib/auth";
import styles from "./pulls.module.css";

type PullRequest = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  sourceBranch: string;
  targetBranch: string;
  status: "OPEN" | "CLOSED" | "MERGED";
  author: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
};
type Branch = { name: string };
type ListResult = { pullRequests: PullRequest[]; page: number; hasMore: boolean; permissions: { canCreate: boolean } };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, { ...init, cache: "no-store", headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string }; message?: string } | null;
    throw new Error(body?.error?.message ?? body?.message ?? `Yêu cầu thất bại (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const baseFor = (owner: string, repo: string) => `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const stateText = (state: PullRequest["status"]) => state === "OPEN" ? "Đang mở" : state === "MERGED" ? "Đã merge" : "Đã đóng";

export default function PullRequestListPage() {
  const params = useParams<{ username: string; repo: string }>();
  const owner = params.username;
  const repo = params.repo;
  const router = useRouter();
  const base = useMemo(() => baseFor(owner, repo), [owner, repo]);
  const [state, setState] = useState<"ALL" | PullRequest["status"]>("ALL");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListResult | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchError, setBranchError] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const headerCreateRef = useRef<HTMLButtonElement>(null);
  const emptyCreateRef = useRef<HTMLButtonElement>(null);
  const createOpenerRef = useRef<"header" | "empty" | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const wasCreateOpen = useRef(false);

  useEffect(() => {
    if (createOpen) {
      wasCreateOpen.current = true;
      titleInputRef.current?.focus();
    } else if (wasCreateOpen.current) {
      wasCreateOpen.current = false;
      const opener = createOpenerRef.current;
      createOpenerRef.current = null;
      (opener === "empty" ? emptyCreateRef : headerCreateRef).current?.focus();
    }
  }, [createOpen]);

  useEffect(() => { if (formError) formErrorRef.current?.focus(); }, [formError]);

  const fetchPage = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), ...(state === "ALL" ? {} : { status: state }) });
    const branchRequest = requestJson<{ branches: Branch[] }>(`${base}/branches`)
      .then((data) => ({ branches: data.branches, error: "" }))
      .catch(() => ({ branches: [], error: "Không thể tải danh sách branch. Vui lòng thử lại trước khi tạo pull request." }));
    const [next, branchResult] = await Promise.all([
      requestJson<ListResult>(`${base}/pulls?${query}`),
      branchRequest,
    ]);
    return { next, ...branchResult };
  }, [base, state, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPage();
      setError(""); setResult(data.next); setBranches(data.branches); setBranchError(data.error);
      setTarget((current) => current || data.branches.find((branch) => branch.name === "main")?.name || data.branches[0]?.name || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải danh sách pull request."); }
    finally { setLoading(false); }
  }, [fetchPage]);

  useEffect(() => {
    let active = true;
    void fetchPage().then((data) => {
      if (!active) return;
      setError(""); setResult(data.next); setBranches(data.branches); setBranchError(data.error);
      setTarget((current) => current || data.branches.find((branch) => branch.name === "main")?.name || data.branches[0]?.name || "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không thể tải danh sách pull request.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchPage]);

  async function retryBranches() {
    setBranchLoading(true);
    try {
      const data = await requestJson<{ branches: Branch[] }>(`${base}/branches`);
      setBranches(data.branches);
      setBranchError("");
      setTarget((current) => current || data.branches.find((branch) => branch.name === "main")?.name || data.branches[0]?.name || "");
    } catch {
      setBranchError("Không thể tải danh sách branch. Vui lòng thử lại trước khi tạo pull request.");
    } finally {
      setBranchLoading(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    if (!source || !target || source === target) { setFormError("Hãy chọn hai branch khác nhau."); return; }
    setSaving(true);
    try {
      const created = await requestJson<{ pullRequest: PullRequest }>(`${base}/pulls`, { method: "POST", body: JSON.stringify({ title, description: description || null, sourceBranch: source, targetBranch: target }) });
      router.push(`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${created.pullRequest.number}`);
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Không thể tạo pull request."); }
    finally { setSaving(false); }
  }

  return <main className={`container ${styles.page}`} aria-busy={loading || saving}>
    <nav className={styles.breadcrumb} aria-label="Điều hướng"><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}>{owner}/{repo}</Link><span aria-hidden="true">/</span><strong>Pull requests</strong></nav>
    <header className={styles.header}>
      <div><span className="eyebrow">Cộng tác</span><h1>Pull requests</h1><p>Xem và trao đổi các thay đổi giữa những branch trong repository này.</p></div>
      {result?.permissions.canCreate && <button ref={headerCreateRef} className="button buttonPrimary" onClick={() => {
        if (createOpen) setCreateOpen(false);
        else { createOpenerRef.current = "header"; setCreateOpen(true); }
      }} aria-expanded={createOpen} aria-controls="create-pull-request">Tạo pull request</button>}
    </header>

    {createOpen && <section id="create-pull-request" className={styles.panel} aria-labelledby="create-title">
      <h2 id="create-title">Tạo pull request mới</h2>
      <form className={styles.form} onSubmit={create}>
        <label htmlFor="pr-title">Tiêu đề</label><input ref={titleInputRef} id="pr-title" required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} />
        {branchError ? <div className={`${styles.error} ${styles.branchError}`} role="alert"><span>{branchError}</span><button type="button" disabled={branchLoading} onClick={() => void retryBranches()}>{branchLoading ? "Đang tải…" : "Thử tải lại branch"}</button></div> : <div className={styles.branchFields}>
          <div><label htmlFor="pr-source">Branch nguồn</label>{branches.length ? <select id="pr-source" required value={source} onChange={(event) => setSource(event.target.value)}><option value="">Chọn branch</option>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select> : <input id="pr-source" required value={source} onChange={(event) => setSource(event.target.value)} placeholder="feature/my-change" />}</div>
          <span className={styles.arrow} aria-hidden="true">→</span>
          <div><label htmlFor="pr-target">Branch đích</label>{branches.length ? <select id="pr-target" required value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Chọn branch</option>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select> : <input id="pr-target" required value={target} onChange={(event) => setTarget(event.target.value)} placeholder="main" />}</div>
        </div>}
        <label htmlFor="pr-description">Mô tả <span className={styles.muted}>(không bắt buộc)</span></label><textarea id="pr-description" rows={5} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} />
        {formError && <p ref={formErrorRef} className={styles.error} role="alert" tabIndex={-1}>{formError}</p>}
        <div className={styles.actions}><button className="button buttonPrimary" disabled={saving || Boolean(branchError)}>{saving ? "Đang tạo…" : "Tạo pull request"}</button><button type="button" className="button buttonSecondary" onClick={() => setCreateOpen(false)}>Hủy</button></div>
      </form>
    </section>}

    <div className={styles.filters} role="group" aria-label="Lọc pull requests">
      {([ ["ALL", "Tất cả"], ["OPEN", "Đang mở"], ["CLOSED", "Đã đóng"], ["MERGED", "Đã merge"] ] as const).map(([value, label]) => <button key={value} className={state === value ? styles.filterActive : ""} aria-pressed={state === value} onClick={() => { setLoading(true); setPage(1); setState(value); }}>{label}</button>)}
    </div>

    {loading ? <p className={styles.status} role="status">Đang tải pull requests…</p> : error ? <section className={styles.panel}><p className={styles.error} role="alert">{error}</p><button className="button buttonSecondary" onClick={() => { setLoading(true); void load(); }}>Thử lại</button></section> : result?.pullRequests.length ? <ul className={styles.list}>
      {result.pullRequests.map((item) => <li key={item.id}>
        <div className={styles.itemIcon} aria-hidden="true">{item.status === "MERGED" ? "✓" : item.status === "CLOSED" ? "×" : "↗"}</div>
        <div className={styles.itemContent}><Link className={styles.itemTitle} href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${item.number}`}>{item.title} <span className={styles.muted}>#{item.number}</span></Link><p>{item.author.username} muốn merge <code>{item.sourceBranch}</code> vào <code>{item.targetBranch}</code> · {new Date(item.updatedAt).toLocaleDateString("vi-VN")}</p></div>
        <span className={`${styles.state} ${styles[`state${item.status}`]}`}>{stateText(item.status)}</span>
      </li>)}
    </ul> : <section className={styles.empty}><span aria-hidden="true">⑂</span><h2>Chưa có pull request</h2><p>{state === "ALL" ? "Khi có thay đổi giữa các branch, bạn có thể tạo pull request để xem diff và yêu cầu merge." : "Không có pull request nào trong trạng thái này."}</p>{result?.permissions.canCreate && !createOpen && <button ref={emptyCreateRef} className="button buttonSecondary" aria-expanded={createOpen} aria-controls="create-pull-request" onClick={() => { createOpenerRef.current = "empty"; setCreateOpen(true); }}>Tạo pull request</button>}</section>}
    {!loading && result && (page > 1 || result.hasMore) && <nav className={styles.pagination} aria-label="Phân trang"><button className="button buttonSecondary" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => Math.max(1, current - 1)); }}>Trang trước</button><span>Trang {page}</span><button className="button buttonSecondary" disabled={!result.hasMore} onClick={() => { setLoading(true); setPage((current) => current + 1); }}>Trang sau</button></nav>}
  </main>;
}
