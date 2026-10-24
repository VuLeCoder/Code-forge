"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { sessionFetch } from "@/lib/auth";
import styles from "../pulls.module.css";

type PullRequest = {
  id: string; number: number; title: string; description: string | null; sourceBranch: string; targetBranch: string;
  status: "OPEN" | "CLOSED" | "MERGED"; version: number; storageGeneration: number; sourceSha: string; targetSha: string;
  author: { id: string; username: string }; mergedBy?: { id: string; username: string } | null; mergedAt?: string | null; mergeCommitSha?: string | null;
};
type Permissions = { canCreate: boolean; canEdit: boolean; canMerge: boolean };
type MergeOperation = { operationId: string; status: "PENDING" | "NEEDS_RECONCILIATION" | "COMPLETED" | "FAILED"; errorCode: string | null } | null;
type DetailResult = { pullRequest: PullRequest; permissions: Permissions; mergeOperation?: MergeOperation };
type Commit = { sha: string; subject: string; author: { name: string; email: string }; authoredAt: string };
type ChangedFile = { status: string; path: string; previousPath?: string };
type CompareResult = { state: "READY" | "ALREADY_MERGED" | "NO_MERGE_BASE" | "STORAGE_RESET"; sourceSha: string; targetSha: string; mergeBase: string | null; commits: Commit[]; files: ChangedFile[]; diff: string; diffTruncated: boolean; storageGeneration: number; stale?: boolean };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, { ...init, cache: "no-store", headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string }; message?: string } | null;
    throw new Error(body?.error?.message ?? body?.message ?? `Yêu cầu thất bại (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const stateText = (state: PullRequest["status"]) => state === "OPEN" ? "Đang mở" : state === "MERGED" ? "Đã merge" : "Đã đóng";

export default function PullRequestDetailPage() {
  const params = useParams<{ username: string; repo: string; number: string }>();
  const owner = params.username;
  const repo = params.repo;
  const number = Number(params.number);
  const base = useMemo(() => `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(params.number)}`, [owner, repo, params.number]);
  const [result, setResult] = useState<DetailResult | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const fetchCurrent = useCallback(() => Promise.all([
    requestJson<DetailResult>(base), requestJson<CompareResult>(`${base}/compare`),
  ]), [base]);

  const load = useCallback(async () => {
    setLoading(true); setActionError("");
    try {
      const [detail, snapshot] = await fetchCurrent();
      setError(""); setResult(detail); setCompare(snapshot);
      setReconciling(detail.mergeOperation?.status === "PENDING" || detail.mergeOperation?.status === "NEEDS_RECONCILIATION");
      setTitle(detail.pullRequest.title); setDescription(detail.pullRequest.description ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải pull request."); }
    finally { setLoading(false); }
  }, [fetchCurrent]);

  useEffect(() => {
    let active = true;
    void fetchCurrent().then(([detail, snapshot]) => {
      if (!active) return;
      setError(""); setResult(detail); setCompare(snapshot);
      setReconciling(detail.mergeOperation?.status === "PENDING" || detail.mergeOperation?.status === "NEEDS_RECONCILIATION");
      setTitle(detail.pullRequest.title); setDescription(detail.pullRequest.description ?? "");
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không thể tải pull request.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchCurrent]);

  useEffect(() => {
    if (!reconciling) return;
    let active = true;
    const timer = setInterval(() => {
      void fetchCurrent().then(([detail, snapshot]) => {
        if (!active) return;
        setResult(detail); setCompare(snapshot);
        setReconciling(detail.mergeOperation?.status === "PENDING" || detail.mergeOperation?.status === "NEEDS_RECONCILIATION");
        if (detail.mergeOperation?.status === "FAILED") {
          setActionError("Merge không được áp dụng. Hãy kiểm tra snapshot mới nhất trước khi thử lại.");
        }
      }).catch(() => { /* Keep the pending state visible and retry on the next poll. */ });
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [fetchCurrent, reconciling]);

  async function update(fields: { title?: string; description?: string | null; state?: "OPEN" | "CLOSED" }) {
    setBusy(true); setActionError("");
    try { await requestJson<DetailResult>(base, { method: "PATCH", body: JSON.stringify(fields) }); setEditing(false); await load(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Không thể cập nhật pull request."); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await update({ title, description: description || null });
  }

  async function merge() {
    if (!result || !compare) return;
    setBusy(true); setActionError("");
    try {
      const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const outcome = await requestJson<{ status: "MERGED" | "RECONCILING"; operationId: string; mergeCommitSha?: string }>(`${base}/merge`, {
        method: "POST", body: JSON.stringify({ operationId, expectedSourceSha: compare.sourceSha, expectedTargetSha: compare.targetSha,
          storageGeneration: compare.storageGeneration, version: result.pullRequest.version }),
      });
      setConfirmMerge(false);
      if (outcome.status === "RECONCILING") setReconciling(true);
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? `${cause.message} Tải lại compare để kiểm tra snapshot mới nhất.` : "Không thể merge pull request.");
      setConfirmMerge(false);
    } finally { setBusy(false); }
  }

  if (loading) return <main className={`container ${styles.page}`}><p role="status">Đang tải pull request…</p></main>;
  if (error || !result || !compare) return <main className={`container ${styles.page}`}><p className={styles.error} role="alert">{error || "Không tìm thấy pull request."}</p><button className="button buttonSecondary" onClick={() => { setLoading(true); void load(); }}>Thử lại</button></main>;

  const pull = result.pullRequest;
  const canEdit = result.permissions.canEdit && pull.status !== "MERGED";
  const canMerge = result.permissions.canMerge && pull.status === "OPEN" && compare.state === "READY" && !compare.stale && !reconciling;
  return <main className={`container ${styles.page}`}>
    <nav className={styles.breadcrumb} aria-label="Điều hướng"><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}>{owner}/{repo}</Link><span aria-hidden="true">/</span><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`}>Pull requests</Link><span aria-hidden="true">/</span><strong>#{number}</strong></nav>
    <header className={styles.header}>
      <div><span className="eyebrow">Pull request #{pull.number}</span><h1>{pull.title} <span className={styles.muted}>#{pull.number}</span></h1><p><span className={`${styles.state} ${styles[`state${pull.status}`]}`}>{stateText(pull.status)}</span> {pull.author.username} đề nghị merge <code>{pull.sourceBranch}</code> vào <code>{pull.targetBranch}</code></p></div>
      <div className={styles.actions}>
        {canEdit && <button className="button buttonSecondary" onClick={() => setEditing((value) => !value)} aria-expanded={editing}>Chỉnh sửa</button>}
        {canEdit && <button className="button buttonSecondary" disabled={busy} onClick={() => void update({ state: pull.status === "OPEN" ? "CLOSED" : "OPEN" })}>{pull.status === "OPEN" ? "Đóng" : "Mở lại"}</button>}
        {result.permissions.canMerge && pull.status === "OPEN" && <button className="button buttonPrimary" disabled={!canMerge || busy} onClick={() => setConfirmMerge(true)}>Merge pull request</button>}
      </div>
    </header>

    {actionError && <p className={styles.error} role="alert">{actionError}</p>}
    {reconciling && <p className={styles.warning} role="status">Git đã nhận yêu cầu merge. Hệ thống đang đối soát; nút merge sẽ được mở lại sau khi trạng thái được xác nhận.</p>}
    {result.mergeOperation?.status === "FAILED" && <p className={styles.warning} role="status">Merge trước không cập nhật branch. Hãy kiểm tra snapshot mới nhất trước khi thử lại.</p>}
    {editing && <section className={styles.panel} aria-labelledby="edit-title"><h2 id="edit-title">Chỉnh sửa pull request</h2><form className={styles.form} onSubmit={save}>
      <label htmlFor="edit-title-input">Tiêu đề</label><input id="edit-title-input" required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} />
      <label htmlFor="edit-description">Mô tả</label><textarea id="edit-description" rows={6} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className={styles.actions}><button className="button buttonPrimary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button className="button buttonSecondary" type="button" onClick={() => setEditing(false)}>Hủy</button></div>
    </form></section>}

    {confirmMerge && <section className={styles.confirm} aria-labelledby="merge-confirm-title"><h2 id="merge-confirm-title">Xác nhận merge</h2><p>Merge <code>{pull.sourceBranch}</code> vào <code>{pull.targetBranch}</code> bằng merge commit? Hãy xem lại danh sách file và diff bên dưới trước khi tiếp tục.</p><p className={styles.snapshot}>Source <code>{compare.sourceSha.slice(0, 12)}</code> · Target <code>{compare.targetSha.slice(0, 12)}</code></p><div className={styles.actions}><button className="button buttonPrimary" disabled={busy} onClick={() => void merge()}>{busy ? "Đang merge…" : "Xác nhận merge"}</button><button className="button buttonSecondary" onClick={() => setConfirmMerge(false)}>Hủy</button></div></section>}

    {pull.status === "MERGED" && <p className={styles.success} role="status">Đã merge{pull.mergedBy ? ` bởi ${pull.mergedBy.username}` : ""}{pull.mergeCommitSha ? <> · commit <code>{pull.mergeCommitSha.slice(0, 12)}</code></> : ""}.</p>}
    {compare.state === "STORAGE_RESET" && <p className={styles.warning} role="status">Storage của repository đã được khởi tạo lại. Các branch nguồn không còn khả dụng; PR này được giữ trong lịch sử và không thể merge.</p>}
    {compare.state === "NO_MERGE_BASE" && <p className={styles.warning} role="status">Hai branch không còn merge-base chung. Hãy đóng PR và tạo PR mới từ lịch sử phù hợp.</p>}
    {compare.state === "ALREADY_MERGED" && <p className={styles.success} role="status">Các commit nguồn đã có trong branch đích.</p>}
    {compare.stale && <p className={styles.warning} role="status">Branch đã thay đổi kể từ lúc tạo PR. Hãy kiểm tra snapshot mới bên dưới trước khi merge.</p>}
    {compare.diffTruncated && <p className={styles.warning} role="status">Diff đã được rút gọn theo giới hạn hiển thị. Tải clone để xem toàn bộ nội dung.</p>}

    <section className={styles.panel} aria-labelledby="description-title"><h2 id="description-title">Mô tả</h2>{pull.description ? <p className={styles.description}>{pull.description}</p> : <p className={styles.muted}>Chưa có mô tả.</p>}</section>
    <section className={styles.panel} aria-labelledby="commits-title"><h2 id="commits-title">Commits <span className={styles.count}>{compare.commits.length}</span></h2>{compare.commits.length ? <ol className={styles.commitList}>{compare.commits.map((commit) => <li key={commit.sha}><code>{commit.sha.slice(0, 12)}</code><span>{commit.subject || "(không có tiêu đề)"}</span><small>{commit.author.name} · {new Date(commit.authoredAt).toLocaleString("vi-VN")}</small></li>)}</ol> : <p className={styles.muted}>Không có commit mới trong snapshot này.</p>}</section>
    <section className={styles.panel} aria-labelledby="files-title"><h2 id="files-title">Files changed <span className={styles.count}>{compare.files.length}</span></h2>{compare.files.length ? <ul className={styles.fileList}>{compare.files.map((file, index) => <li key={`${file.path}-${index}`}><span className={styles.fileStatus} aria-label={`Trạng thái ${file.status}`}>{file.status}</span><code>{file.previousPath ? `${file.previousPath} → ` : ""}{file.path}</code></li>)}</ul> : <p className={styles.muted}>Không có file thay đổi.</p>}</section>
    <section className={styles.panel} aria-labelledby="diff-title"><h2 id="diff-title">Diff</h2>{compare.diff ? <pre className={styles.diff} tabIndex={0} aria-label="Nội dung diff dạng văn bản">{compare.diff}</pre> : <p className={styles.muted}>Diff trống.</p>}</section>
    <div className={styles.bottom}><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`}>Quay lại danh sách</Link><button className={styles.refresh} disabled={busy} onClick={() => { setLoading(true); void load(); }}>Tải lại dữ liệu</button></div>
  </main>;
}
