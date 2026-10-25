"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type ChangedFile = {
  status: string;
  path: string;
  previousPath?: string;
  diffStatus?: "TEXT" | "BINARY" | "TRUNCATED" | "UNAVAILABLE";
  diff?: string;
  diffTruncated?: boolean;
};
type CompareSummary = { state: "READY" | "ALREADY_MERGED" | "NO_MERGE_BASE" | "STORAGE_RESET"; sourceSha: string; targetSha: string; mergeBase: string | null; storageGeneration: number; stale?: boolean };
type Pagination = { page: number; pageSize: number; totalItems: number; totalPages: number; hasMore: boolean };
type Snapshot = Pick<CompareSummary, "sourceSha" | "targetSha" | "storageGeneration">;
type CommitPage = { snapshot: Snapshot; pagination: Pagination; commits: Commit[] };
type FilePage = { snapshot: Snapshot; pagination: Pagination; files: ChangedFile[] };

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, { ...init, cache: "no-store", headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string }; message?: string } | null;
    throw new ApiRequestError(body?.error?.message ?? body?.message ?? `Yêu cầu thất bại (${response.status}).`, response.status, body?.error?.code);
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
  const [compare, setCompare] = useState<CompareSummary | null>(null);
  const [commitsPage, setCommitsPage] = useState<CommitPage | null>(null);
  const [filesPage, setFilesPage] = useState<FilePage | null>(null);
  const [diffPage, setDiffPage] = useState<FilePage | null>(null);
  const [sectionBusy, setSectionBusy] = useState({ commits: false, files: false });
  const [sectionErrors, setSectionErrors] = useState({ commits: "", files: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const actionErrorRef = useRef<HTMLParagraphElement>(null);
  const mergeConfirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const mergeTriggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirmOpen = useRef(false);
  const wasEditing = useRef(false);

  useEffect(() => { if (actionError) actionErrorRef.current?.focus(); }, [actionError]);
  useEffect(() => {
    if (confirmMerge) {
      wasConfirmOpen.current = true;
      mergeConfirmHeadingRef.current?.focus();
    } else if (wasConfirmOpen.current) {
      wasConfirmOpen.current = false;
      if (!actionError) mergeTriggerRef.current?.focus();
    }
  }, [confirmMerge, actionError]);
  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      document.getElementById("edit-title-input")?.focus();
    } else if (wasEditing.current) {
      wasEditing.current = false;
      document.getElementById("edit-pr-trigger")?.focus();
    }
  }, [editing]);

  const fetchCurrent = useCallback(() => Promise.all([
    requestJson<DetailResult>(base), requestJson<CompareSummary>(`${base}/compare?summary=true`),
  ]), [base]);

  const fetchPageSet = useCallback((snapshot: Snapshot, page = 1) => {
    const query = new URLSearchParams({ sourceSha: snapshot.sourceSha, targetSha: snapshot.targetSha,
      storageGeneration: String(snapshot.storageGeneration), page: String(page), pageSize: "20" });
    return Promise.all([
      requestJson<CommitPage>(`${base}/commits?${query}`),
      requestJson<FilePage>(`${base}/files?${query}`),
      requestJson<FilePage>(`${base}/diff?${query}`),
    ]);
  }, [base]);

  const isStaleSnapshot = (cause: unknown) => cause instanceof ApiRequestError && cause.status === 409 && cause.code === "STALE_COMPARE";
  const matchesSnapshot = (value: Snapshot, snapshot: Snapshot) => value.sourceSha === snapshot.sourceSha
    && value.targetSha === snapshot.targetSha && value.storageGeneration === snapshot.storageGeneration;

  const load = useCallback(async () => {
    setLoading(true); setActionError("");
    setSectionErrors({ commits: "", files: "" });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const [detail, snapshot] = await fetchCurrent();
          let pages: [CommitPage, FilePage, FilePage] | null = null;
          if (snapshot.state === "READY") {
            try { pages = await fetchPageSet(snapshot); }
            catch (cause) { if (isStaleSnapshot(cause) && attempt === 0) continue; throw cause; }
            if (!pages.every((page) => matchesSnapshot(page.snapshot, snapshot))) {
              if (attempt === 0) continue;
              throw new ApiRequestError("Snapshot compare đã thay đổi. Hãy tải lại.", 409, "STALE_COMPARE");
            }
          }
          setError(""); setResult(detail); setCompare(snapshot);
          setCommitsPage(pages?.[0] ?? null); setFilesPage(pages?.[1] ?? null); setDiffPage(pages?.[2] ?? null);
          setReconciling(detail.mergeOperation?.status === "PENDING" || detail.mergeOperation?.status === "NEEDS_RECONCILIATION");
          setTitle(detail.pullRequest.title); setDescription(detail.pullRequest.description ?? "");
          return;
        } catch (cause) {
          if (isStaleSnapshot(cause) && attempt === 0) continue;
          setError(cause instanceof Error ? cause.message : "Không thể tải pull request.");
          return;
        }
      }
      setError("Snapshot compare thay đổi liên tục. Hãy thử tải lại.");
    } finally { setLoading(false); }
  }, [fetchCurrent, fetchPageSet]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!reconciling) return;
    let active = true;
    const timer = setInterval(() => {
      void fetchCurrent().then(([detail, snapshot]) => {
        if (!active) return;
        if (!compare || snapshot.sourceSha !== compare.sourceSha || snapshot.targetSha !== compare.targetSha
          || snapshot.storageGeneration !== compare.storageGeneration || snapshot.state !== compare.state) {
          void load();
          return;
        }
        setResult(detail); setCompare(snapshot);
        setReconciling(detail.mergeOperation?.status === "PENDING" || detail.mergeOperation?.status === "NEEDS_RECONCILIATION");
        if (detail.mergeOperation?.status === "FAILED") {
          setActionError("Merge không được áp dụng. Hãy kiểm tra snapshot mới nhất trước khi thử lại.");
        }
      }).catch(() => { /* Keep the pending state visible and retry on the next poll. */ });
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [compare, fetchCurrent, load, reconciling]);

  const changeCommitPage = useCallback(async (page: number) => {
    if (!compare || page < 1 || page > (commitsPage?.pagination.totalPages ?? 1)) return;
    setSectionBusy((state) => ({ ...state, commits: true })); setSectionErrors((state) => ({ ...state, commits: "" }));
    try {
      const query = new URLSearchParams({ sourceSha: compare.sourceSha, targetSha: compare.targetSha,
        storageGeneration: String(compare.storageGeneration), page: String(page), pageSize: "20" });
      const response = await requestJson<CommitPage>(`${base}/commits?${query}`);
      if (!matchesSnapshot(response.snapshot, compare)) throw new ApiRequestError("Snapshot compare đã thay đổi.", 409, "STALE_COMPARE");
      setCommitsPage(response);
    } catch (cause) {
      if (isStaleSnapshot(cause)) void load();
      else setSectionErrors((state) => ({ ...state, commits: cause instanceof Error ? cause.message : "Không thể tải commits." }));
    } finally { setSectionBusy((state) => ({ ...state, commits: false })); }
  }, [base, compare, commitsPage?.pagination.totalPages, load]);

  const changeFilePage = useCallback(async (page: number) => {
    if (!compare || page < 1 || page > (filesPage?.pagination.totalPages ?? 1)) return;
    setSectionBusy((state) => ({ ...state, files: true })); setSectionErrors((state) => ({ ...state, files: "" }));
    try {
      const query = new URLSearchParams({ sourceSha: compare.sourceSha, targetSha: compare.targetSha,
        storageGeneration: String(compare.storageGeneration), page: String(page), pageSize: "20" });
      const [files, diff] = await Promise.all([
        requestJson<FilePage>(`${base}/files?${query}`), requestJson<FilePage>(`${base}/diff?${query}`),
      ]);
      if (!matchesSnapshot(files.snapshot, compare) || !matchesSnapshot(diff.snapshot, compare)) {
        throw new ApiRequestError("Snapshot compare đã thay đổi.", 409, "STALE_COMPARE");
      }
      setFilesPage(files); setDiffPage(diff);
    } catch (cause) {
      if (isStaleSnapshot(cause)) void load();
      else setSectionErrors((state) => ({ ...state, files: cause instanceof Error ? cause.message : "Không thể tải files và diff." }));
    } finally { setSectionBusy((state) => ({ ...state, files: false })); }
  }, [base, compare, filesPage?.pagination.totalPages, load]);

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

  if (loading) return <main className={`container ${styles.page}`} aria-busy="true"><p role="status">Đang tải pull request…</p></main>;
  if (error || !result || !compare) return <main className={`container ${styles.page}`} aria-busy="false"><p className={styles.error} role="alert">{error || "Không tìm thấy pull request."}</p><button className="button buttonSecondary" onClick={() => { setLoading(true); void load(); }}>Thử lại</button></main>;

  const pull = result.pullRequest;
  const canEdit = result.permissions.canEdit && pull.status !== "MERGED";
  const canMerge = result.permissions.canMerge && pull.status === "OPEN" && compare.state === "READY" && !compare.stale && !reconciling;
  const renderPagination = (label: string, pagination: Pagination | undefined, busy: boolean, onPage: (page: number) => void) => {
    if (!pagination || pagination.totalPages <= 1) return null;
    return <nav className={styles.pagination} aria-label={`Phân trang ${label}`}>
      <button className="button buttonSecondary" disabled={busy || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Trang trước</button>
      <span aria-live="polite">Trang {pagination.page}/{pagination.totalPages} · {pagination.totalItems} mục</span>
      <button className="button buttonSecondary" disabled={busy || !pagination.hasMore} onClick={() => onPage(pagination.page + 1)}>Trang tiếp</button>
    </nav>;
  };
  const pageStatus = compare.state === "STORAGE_RESET" ? "Source không còn khả dụng sau khi storage được khởi tạo lại."
    : compare.state === "NO_MERGE_BASE" ? "Không thể liệt kê thay đổi vì hai branch không còn merge-base chung."
      : "Không có mục nào trong snapshot này.";
  const pageBusy = loading || busy || sectionBusy.commits || sectionBusy.files;
  return <main className={`container ${styles.page}`} aria-busy={pageBusy}>
    <nav className={styles.breadcrumb} aria-label="Điều hướng"><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}>{owner}/{repo}</Link><span aria-hidden="true">/</span><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`}>Pull requests</Link><span aria-hidden="true">/</span><strong>#{number}</strong></nav>
    <header className={styles.header}>
      <div><span className="eyebrow">Pull request #{pull.number}</span><h1>{pull.title} <span className={styles.muted}>#{pull.number}</span></h1><p><span className={`${styles.state} ${styles[`state${pull.status}`]}`}>{stateText(pull.status)}</span> {pull.author.username} đề nghị merge <code>{pull.sourceBranch}</code> vào <code>{pull.targetBranch}</code></p></div>
      <div className={styles.actions}>
        {canEdit && <button id="edit-pr-trigger" className="button buttonSecondary" onClick={() => setEditing((value) => !value)} aria-expanded={editing} aria-controls="edit-pull-request">Chỉnh sửa</button>}
        {canEdit && <button className="button buttonSecondary" disabled={busy} onClick={() => void update({ state: pull.status === "OPEN" ? "CLOSED" : "OPEN" })}>{pull.status === "OPEN" ? "Đóng" : "Mở lại"}</button>}
        {result.permissions.canMerge && pull.status === "OPEN" && <button ref={mergeTriggerRef} className="button buttonPrimary" disabled={!canMerge || busy} onClick={() => setConfirmMerge(true)} aria-expanded={confirmMerge} aria-controls="merge-confirmation">Merge pull request</button>}
      </div>
    </header>

    {actionError && <p ref={actionErrorRef} className={styles.error} role="alert" tabIndex={-1}>{actionError}</p>}
    {reconciling && <p className={styles.warning} role="status">Git đã nhận yêu cầu merge. Hệ thống đang đối soát; nút merge sẽ được mở lại sau khi trạng thái được xác nhận.</p>}
    {result.mergeOperation?.status === "FAILED" && <p className={styles.warning} role="status">Merge trước không cập nhật branch. Hãy kiểm tra snapshot mới nhất trước khi thử lại.</p>}
    {editing && <section id="edit-pull-request" className={styles.panel} aria-labelledby="edit-title"><h2 id="edit-title">Chỉnh sửa pull request</h2><form className={styles.form} onSubmit={save}>
      <label htmlFor="edit-title-input">Tiêu đề</label><input id="edit-title-input" required maxLength={256} value={title} onChange={(event) => setTitle(event.target.value)} />
      <label htmlFor="edit-description">Mô tả</label><textarea id="edit-description" rows={6} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className={styles.actions}><button className="button buttonPrimary" disabled={busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button><button className="button buttonSecondary" type="button" onClick={() => setEditing(false)}>Hủy</button></div>
    </form></section>}

    {confirmMerge && <section id="merge-confirmation" className={styles.confirm} aria-labelledby="merge-confirm-title"><h2 ref={mergeConfirmHeadingRef} id="merge-confirm-title" tabIndex={-1}>Xác nhận merge</h2><p>Merge <code>{pull.sourceBranch}</code> vào <code>{pull.targetBranch}</code> bằng merge commit? Hãy xem lại danh sách file và diff bên dưới trước khi tiếp tục.</p><p className={styles.snapshot}>Source <code>{compare.sourceSha.slice(0, 12)}</code> · Target <code>{compare.targetSha.slice(0, 12)}</code></p><div className={styles.actions}><button className="button buttonPrimary" disabled={busy} onClick={() => void merge()}>{busy ? "Đang merge…" : "Xác nhận merge"}</button><button className="button buttonSecondary" onClick={() => setConfirmMerge(false)}>Hủy</button></div></section>}

    {pull.status === "MERGED" && <p className={styles.success} role="status">Đã merge{pull.mergedBy ? ` bởi ${pull.mergedBy.username}` : ""}{pull.mergeCommitSha ? <> · commit <code>{pull.mergeCommitSha.slice(0, 12)}</code></> : ""}.</p>}
    {compare.state === "STORAGE_RESET" && <p className={styles.warning} role="status">Storage của repository đã được khởi tạo lại. Các branch nguồn không còn khả dụng; PR này được giữ trong lịch sử và không thể merge.</p>}
    {compare.state === "NO_MERGE_BASE" && <p className={styles.warning} role="status">Hai branch không còn merge-base chung. Hãy đóng PR và tạo PR mới từ lịch sử phù hợp.</p>}
    {compare.state === "ALREADY_MERGED" && <p className={styles.success} role="status">Các commit nguồn đã có trong branch đích.</p>}
    {compare.stale && <p className={styles.warning} role="status">Branch đã thay đổi kể từ lúc tạo PR. Hãy kiểm tra snapshot mới bên dưới trước khi merge.</p>}
    <section className={styles.panel} aria-labelledby="description-title"><h2 id="description-title">Mô tả</h2>{pull.description ? <p className={styles.description}>{pull.description}</p> : <p className={styles.muted}>Chưa có mô tả.</p>}</section>
    <section className={styles.panel} aria-labelledby="commits-title" aria-busy={sectionBusy.commits}>
      <h2 id="commits-title">Commits <span className={styles.count}>{commitsPage?.pagination.totalItems ?? 0}</span></h2>
      {sectionErrors.commits && <p className={styles.error} role="alert">{sectionErrors.commits} <button className={styles.refresh} onClick={() => void changeCommitPage(commitsPage?.pagination.page ?? 1)}>Thử lại</button></p>}
      {sectionBusy.commits && <p className={styles.status} role="status">Đang tải commits…</p>}
      {commitsPage?.commits.length ? <ol className={styles.commitList}>{commitsPage.commits.map((commit) => <li key={commit.sha}><code>{commit.sha.slice(0, 12)}</code><span>{commit.subject || "(không có tiêu đề)"}</span><small>{commit.author.name} · {new Date(commit.authoredAt).toLocaleString("vi-VN")}</small></li>)}</ol> : <p className={styles.muted}>{pageStatus}</p>}
      {renderPagination("commits", commitsPage?.pagination, sectionBusy.commits, (page) => void changeCommitPage(page))}
    </section>
    <section className={styles.panel} aria-labelledby="files-title" aria-busy={sectionBusy.files}>
      <h2 id="files-title">Files changed <span className={styles.count}>{filesPage?.pagination.totalItems ?? 0}</span></h2>
      {sectionErrors.files && <p className={styles.error} role="alert">{sectionErrors.files} <button className={styles.refresh} onClick={() => void changeFilePage(filesPage?.pagination.page ?? 1)}>Thử lại</button></p>}
      {sectionBusy.files && <p className={styles.status} role="status">Đang tải files và diff…</p>}
      {filesPage?.files.length ? <ul className={styles.fileList}>{filesPage.files.map((file, index) => <li key={`${file.path}-${index}`}><span className={styles.fileStatus} aria-label={`Trạng thái ${file.status}`}>{file.status}</span><code>{file.previousPath ? `${file.previousPath} → ` : ""}{file.path}</code></li>)}</ul> : <p className={styles.muted}>{pageStatus}</p>}
      {renderPagination("files changed và diff", filesPage?.pagination, sectionBusy.files, (page) => void changeFilePage(page))}
    </section>
    <section className={styles.panel} aria-labelledby="diff-title" aria-busy={sectionBusy.files}>
      <h2 id="diff-title">Diff {diffPage && diffPage.pagination.totalItems > 0 && <span className={styles.count}>Trang {diffPage.pagination.page}/{diffPage.pagination.totalPages}</span>}</h2>
      {diffPage?.files.length ? <div className={styles.fileDiffList}>
      {diffPage.files.map((file, index) => {
        const diffStatus = file.diffStatus ?? (typeof file.diff === "string" ? "TEXT" : "UNAVAILABLE");
        const label = diffStatus === "TEXT" ? "Văn bản" : diffStatus === "BINARY" ? "File nhị phân" : diffStatus === "TRUNCATED" ? "Đã rút gọn" : "Không khả dụng";
        return <article className={styles.fileDiff} key={`${file.path}-${index}`}>
          <h3><code>{file.previousPath ? `${file.previousPath} → ` : ""}{file.path}</code><span className={styles.diffState} role="status">{label}</span></h3>
          {diffStatus === "TEXT" && typeof file.diff === "string" && file.diff.length > 0
            ? <pre className={styles.diff} tabIndex={0} aria-label={`Diff của ${file.path}`}>{file.diff}</pre>
            : diffStatus === "TEXT" && typeof file.diff === "string"
              ? <p className={styles.muted}>Không có dòng diff để hiển thị.</p>
              : diffStatus === "BINARY"
                ? <p className={styles.muted}>Không thể hiển thị diff dạng văn bản cho file nhị phân.</p>
                : diffStatus === "TRUNCATED"
                  ? <p className={styles.warning} role="status">Diff của file này đã vượt giới hạn hiển thị. Clone repository để xem đầy đủ.</p>
                  : <p className={styles.muted}>Diff của file này hiện không khả dụng.</p>}
        </article>;
      })}
    </div> : <p className={styles.muted}>{sectionErrors.files ? "Diff chưa tải được; dùng nút Thử lại ở phần files changed." : pageStatus}</p>}</section>
    <div className={styles.bottom}><Link href={`/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`}>Quay lại danh sách</Link><button className={styles.refresh} disabled={pageBusy} onClick={() => void load()}>Tải lại dữ liệu</button></div>
  </main>;
}
