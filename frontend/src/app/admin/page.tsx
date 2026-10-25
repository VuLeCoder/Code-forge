"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./admin.module.css";

type Tab = "overview" | "users" | "repositories" | "audit";
type PageResult = { page: number; pageSize: number; total: number; hasMore: boolean };
type AdminUser = { id: string; username: string; email: string; systemRole: "USER" | "ADMIN"; status: "ACTIVE" | "LOCKED"; lockedAt: string | null; createdAt: string };
type AdminRepository = { id: string; name: string; description: string | null; visibility: "PUBLIC" | "PRIVATE"; status: "ACTIVE" | "LOCKED" | "DELETED"; defaultBranch: string | null; storageGeneration: number; createdAt: string; updatedAt: string; deletedAt: string | null; purgeAfter: string | null; owner: { id: string; username: string }; _count: { pullRequests: number; members: number } };
type AuditEntry = { id: string; actorId: string | null; action: string; targetId: string; details: Record<string, string | number | boolean | null>; createdAt: string; actor: { id: string; username: string } | null };
type Stats = { users: { total: number; active: number; locked: number }; repositories: { total: number; active: number; locked: number; deleted: number }; pullRequests: { total: number; open: number; pendingMerges: number } };
type RequestError = Error & { status?: number; code?: string };
type PendingAction = { title: string; description: string; path: string; method: "PATCH" | "POST"; body?: unknown };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/admin/${path}`, { ...init, cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error?.message ?? "Không thể thực hiện yêu cầu. Vui lòng thử lại.") as RequestError;
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

function errorGuidance(error: RequestError) {
  if (error.status === 401) return "Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại rồi thử lại.";
  if (error.status === 403) return "Tài khoản hiện tại không có quyền quản trị.";
  if (error.status === 409) return `${error.message} Dữ liệu đã thay đổi; hãy tải lại danh sách trước khi thử lại.`;
  return error.message;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [repositories, setRepositories] = useState<AdminRepository[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pageInfo, setPageInfo] = useState<PageResult>({ page: 1, pageSize: 20, total: 0, hasMore: false });
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const focusReturn = useRef<HTMLButtonElement | null>(null);
  const adminHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (authLoading || !user) return;
    setLoading(true);
    setError("");
    try {
      if (tab === "overview") {
        setStats(await request<Stats>("stats", { signal }));
      } else {
        const params = new URLSearchParams({ page: String(page) });
        if (query) params.set("q", query);
        if (statusFilter) params.set("status", statusFilter);
        if (tab === "audit" && actionFilter) params.set("action", actionFilter);
        const result = tab === "users"
          ? await request<{ users: AdminUser[] } & PageResult>(`users?${params}`, { signal })
          : tab === "repositories"
            ? await request<{ repositories: AdminRepository[] } & PageResult>(`repositories?${params}`, { signal })
            : await request<{ audit: AuditEntry[] } & PageResult>(`audit?${params}`, { signal });
        if (signal?.aborted) return;
        if (tab === "users") setUsers((result as { users: AdminUser[] }).users);
        else if (tab === "repositories") setRepositories((result as { repositories: AdminRepository[] }).repositories);
        else setAudit((result as { audit: AuditEntry[] }).audit);
        setPageInfo({ page: result.page, pageSize: result.pageSize, total: result.total, hasMore: result.hasMore });
      }
    } catch (cause) {
      if (signal?.aborted) return;
      setError(errorGuidance(cause as RequestError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [actionFilter, authLoading, page, query, statusFilter, tab, user]);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() { await load(controller.signal); }
    void refresh();
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (pendingAction && confirmation.current && !confirmation.current.open) confirmation.current.showModal();
  }, [pendingAction]);

  function openAction(opener: HTMLButtonElement, action: PendingAction) {
    focusReturn.current = opener;
    setPendingAction(action);
  }

  function restoreDialogFocus() {
    const opener = focusReturn.current;
    focusReturn.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected && !opener.disabled) {
        opener.focus();
        if (document.activeElement === opener) return;
      }
      adminHeading.current?.focus();
    });
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(searchDraft.trim());
  }

  function chooseTab(next: Tab) {
    setTab(next);
    setPage(1);
    setSearchDraft("");
    setQuery("");
    setStatusFilter("");
    setActionFilter("");
    setError("");
    setNotice("");
  }

  async function confirmMutation() {
    if (!pendingAction) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(pendingAction.path, {
        method: pendingAction.method,
        headers: pendingAction.body ? { "content-type": "application/json" } : undefined,
        body: pendingAction.body ? JSON.stringify(pendingAction.body) : undefined,
      });
      setNotice("Đã cập nhật thành công.");
      setPendingAction(null);
      confirmation.current?.close();
      await load();
    } catch (cause) {
      setError(errorGuidance(cause as RequestError));
      setPendingAction(null);
      confirmation.current?.close();
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <main className={`container ${styles.shell}`}><p role="status">Đang kiểm tra phiên…</p></main>;
  if (!user) return <main className={`container ${styles.shell}`}><h1>Khu vực quản trị</h1><p>Đăng nhập để tiếp tục.</p><Link className="button buttonPrimary" href="/login?returnTo=%2Fadmin">Đăng nhập</Link></main>;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Tổng quan" }, { id: "users", label: "Người dùng" },
    { id: "repositories", label: "Repositories" }, { id: "audit", label: "Nhật ký" },
  ];

  return <main className={`container ${styles.shell}`}>
    <div className={styles.heading}>
      <div><span className="eyebrow">QUẢN TRỊ</span><h1 ref={adminHeading} tabIndex={-1}>Điều hành Code Forge</h1><p>Quản lý tài khoản, repository và theo dõi các thay đổi nhạy cảm. Admin không có quyền xem source private hoặc merge pull request.</p></div>
      <button className="button buttonSecondary" type="button" onClick={() => void load()} disabled={loading}>↻ <span>{loading ? "Đang tải…" : "Tải lại"}</span></button>
    </div>

    <div className={styles.tabs} role="group" aria-label="Các mục quản trị">
      {tabs.map((item) => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => chooseTab(item.id)} className={tab === item.id ? styles.activeTab : ""}>{item.label}</button>)}
    </div>

    <section className={styles.panel} aria-busy={loading} aria-label={tabs.find((item) => item.id === tab)?.label}>
      {error && <div className={styles.alert} role="alert"><span>{error}</span><button type="button" className={styles.inlineButton} onClick={() => void load()}>Thử lại</button></div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {tab === "overview" && <>
        {loading && !stats ? <p role="status">Đang tải thống kê…</p> : stats && <div className={styles.statsGrid}>
          <article className={styles.statCard}><span>Người dùng</span><strong>{stats.users.total}</strong><small>{stats.users.active} hoạt động · {stats.users.locked} bị khóa</small></article>
          <article className={styles.statCard}><span>Repositories</span><strong>{stats.repositories.total}</strong><small>{stats.repositories.active} hoạt động · {stats.repositories.locked} khóa · {stats.repositories.deleted} đã xóa</small></article>
          <article className={styles.statCard}><span>Pull requests</span><strong>{stats.pullRequests.total}</strong><small>{stats.pullRequests.open} đang mở · {stats.pullRequests.pendingMerges} cần đối soát</small></article>
        </div>}
        <p className={styles.privacyNote}>Thông tin source và diff không được hiển thị trong khu vực admin.</p>
      </>}

      {(tab === "users" || tab === "repositories" || tab === "audit") && <>
        <form className={styles.filters} onSubmit={search}>
          <label className={styles.searchField}><span>{tab === "users" ? "Tìm username hoặc email" : tab === "repositories" ? "Tìm repository hoặc chủ sở hữu" : "Tìm hành động hoặc target ID"}</span><input type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Nhập từ khóa" /></label>
          {tab !== "audit" ? <label><span>Trạng thái</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="">Tất cả</option>{tab === "users" ? <><option value="ACTIVE">Hoạt động</option><option value="LOCKED">Đã khóa</option></> : <><option value="ACTIVE">Hoạt động</option><option value="LOCKED">Đã khóa</option><option value="DELETED">Đã xóa</option></>}</select></label> : <label><span>Hành động</span><input value={actionFilter} onChange={(event) => { setActionFilter(event.target.value); setPage(1); }} placeholder="Ví dụ ADMIN_USER_LOCKED" /></label>}
          <button className="button buttonPrimary" type="submit">Tìm kiếm</button>
        </form>

        {loading ? <p role="status" className={styles.empty}>Đang tải dữ liệu…</p> : tab === "users" ? <>
          {users.length === 0 ? <p className={styles.empty}>Không tìm thấy người dùng phù hợp.</p> : <div className={styles.tableWrap}><table><caption className="srOnly">Danh sách người dùng quản trị</caption><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.username}</strong><small>{item.email}</small></td><td>{item.systemRole === "ADMIN" ? "Admin" : "User"}</td><td><span className={item.status === "ACTIVE" ? styles.statusActive : styles.statusLocked}>{item.status === "ACTIVE" ? "Hoạt động" : "Đã khóa"}</span></td><td>{formatDate(item.createdAt)}</td><td>{item.id === user.id && item.status === "ACTIVE" ? <span className={styles.muted}>Tài khoản hiện tại</span> : <button className={styles.tableButton} type="button" onClick={(event) => openAction(event.currentTarget, { title: item.status === "ACTIVE" ? `Khóa ${item.username}?` : `Mở khóa ${item.username}?`, description: item.status === "ACTIVE" ? "Các phiên đăng nhập sẽ bị thu hồi; PAT sẽ không thể dùng khi tài khoản bị khóa." : "Tài khoản có thể đăng nhập và sử dụng lại các quyền hiện có.", path: `users/${encodeURIComponent(item.id)}/status`, method: "PATCH", body: { status: item.status === "ACTIVE" ? "LOCKED" : "ACTIVE" } })}>{item.status === "ACTIVE" ? "Khóa tài khoản" : "Mở khóa"}</button>}</td></tr>)}</tbody></table></div>}
        </> : tab === "repositories" ? <>
          {repositories.length === 0 ? <p className={styles.empty}>Không tìm thấy repository phù hợp.</p> : <div className={styles.tableWrap}><table><caption className="srOnly">Danh sách repository quản trị</caption><thead><tr><th>Repository</th><th>Quyền riêng tư</th><th>Trạng thái</th><th>PR · Thành viên</th><th>Thao tác</th></tr></thead><tbody>{repositories.map((item) => <tr key={item.id}><td><strong>{item.owner.username}/{item.name}</strong><small>{item.description || "Chưa có mô tả"}</small>{item.status === "DELETED" && <small>Hạn khôi phục: {formatDate(item.purgeAfter)}</small>}</td><td>{item.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</td><td><span className={item.status === "ACTIVE" ? styles.statusActive : styles.statusLocked}>{item.status === "ACTIVE" ? "Hoạt động" : item.status === "LOCKED" ? "Đã khóa" : "Đã xóa"}</span></td><td>{item._count.pullRequests} · {item._count.members}</td><td>{item.status === "DELETED" ? <button className={styles.tableButton} type="button" onClick={(event) => openAction(event.currentTarget, { title: `Khôi phục ${item.owner.username}/${item.name}?`, description: "Repository sẽ hoạt động lại. Nếu storage đã reset, source có thể chưa tồn tại và cần push lại từ bản clone.", path: `repositories/${encodeURIComponent(item.id)}/restore`, method: "POST" })}>Khôi phục</button> : <button className={styles.tableButton} type="button" onClick={(event) => openAction(event.currentTarget, { title: item.status === "ACTIVE" ? `Khóa ${item.name}?` : `Mở khóa ${item.name}?`, description: item.status === "ACTIVE" ? "Repository sẽ tạm thời không cho đọc hoặc ghi." : "Repository sẽ được mở lại theo visibility và membership hiện có.", path: `repositories/${encodeURIComponent(item.id)}/status`, method: "PATCH", body: { status: item.status === "ACTIVE" ? "LOCKED" : "ACTIVE" } })}>{item.status === "ACTIVE" ? "Khóa repository" : "Mở khóa"}</button>}</td></tr>)}</tbody></table></div>}
        </> : <>
          {audit.length === 0 ? <p className={styles.empty}>Chưa có sự kiện phù hợp.</p> : <div className={styles.tableWrap}><table><caption className="srOnly">Nhật ký kiểm toán</caption><thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Hành động</th><th>Target</th><th>Chi tiết an toàn</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.actorId === null ? "Hệ thống (bootstrap CLI)" : item.actor?.username ?? "Tài khoản không còn tồn tại"}</td><td><code>{item.action}</code></td><td><code>{item.targetId}</code></td><td>{Object.entries(item.details).map(([key, value]) => `${key}: ${value ?? "—"}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div>}
        </>}

        <div className={styles.pagination} aria-label="Phân trang">
          <span>Trang {pageInfo.page} · {pageInfo.total} kết quả</span>
          <div><button className="button buttonSecondary" type="button" disabled={pageInfo.page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trước</button><button className="button buttonSecondary" type="button" disabled={!pageInfo.hasMore || loading} onClick={() => setPage((value) => value + 1)}>Tiếp</button></div>
        </div>
      </>}
    </section>

    <dialog ref={confirmation} className={styles.dialog} aria-labelledby="admin-confirm-title" aria-describedby="admin-confirm-description" onCancel={(event) => { if (busy) event.preventDefault(); else setPendingAction(null); }} onClose={() => { setPendingAction(null); restoreDialogFocus(); }}>
      <h2 id="admin-confirm-title">{pendingAction?.title}</h2><p id="admin-confirm-description">{pendingAction?.description}</p>
      <div className={styles.dialogActions}><button className="button buttonPrimary" type="button" disabled={busy} onClick={() => void confirmMutation()}>{busy ? "Đang cập nhật…" : "Xác nhận"}</button><button className="button buttonSecondary" type="button" disabled={busy} onClick={() => confirmation.current?.close()}>Hủy</button></div>
    </dialog>
  </main>;
}
