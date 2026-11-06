"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";
import { sessionFetch } from "@/lib/auth";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import styles from "./signed-in-dashboard.module.css";

type Invitation = {
  id: string;
  role: "READ" | "WRITE";
  expiresAt: string;
  repository: { id: string; name: string; owner: { username: string } };
  inviter: { id: string; username: string };
};

type PullRequest = {
  id: string;
  number: number;
  title: string;
  status: "OPEN" | "CLOSED" | "MERGED";
  updatedAt: string;
  author: { id: string; username: string };
};

type DashboardPullRequest = PullRequest & { repository: RepositorySummary };
type DashboardState = {
  key: string;
  repositories: RepositorySummary[];
  invitations: Invitation[];
  pullRequests: DashboardPullRequest[];
  repositoryError: boolean;
  invitationError: boolean;
  pullRequestError: boolean;
};

function RepoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.75h9.5L19 7.25v13H6z" /><path d="M15.5 3.75v3.5H19M9 11h7m-7 3h7m-7 3h4" /></svg>;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export function SignedInDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<DashboardState | null>(null);
  const key = `${user?.id ?? "anonymous"}/${attempt}`;

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;

    async function load() {
      const repositoryResponse = await sessionFetch(`/api/v1/users/${encodeURIComponent(user!.username)}`, { cache: "no-store" });
      if (!repositoryResponse.ok) throw new Error("Không thể tải repository của bạn.");
      const repositoryBody = await repositoryResponse.json() as { repositories?: RepositorySummary[] };
      const repositories = Array.isArray(repositoryBody.repositories) ? repositoryBody.repositories : [];

      const invitationRequest = sessionFetch("/api/v1/invitations", { cache: "no-store" })
        .then(async (response) => response.ok ? { invitations: ((await response.json()) as { invitations?: Invitation[] }).invitations ?? [], error: false } : { invitations: [], error: true })
        .catch(() => ({ invitations: [] as Invitation[], error: true }));

      const pullRequestRequest = Promise.all(repositories.slice(0, 8).map(async (repository) => {
        const response = await sessionFetch(`${repositoryPath(repository).replace(/^\//, "/api/v1/repos/")}/pulls?status=OPEN`, { cache: "no-store" });
        if (!response.ok) throw new Error("Không thể tải pull request.");
        const body = await response.json() as { pullRequests?: PullRequest[] };
        return (body.pullRequests ?? []).map((pullRequest) => ({ ...pullRequest, repository }));
      })).then((groups) => ({ pullRequests: groups.flat().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), error: false }))
        .catch(() => ({ pullRequests: [] as DashboardPullRequest[], error: true }));

      const [invitationResult, pullRequestResult] = await Promise.all([invitationRequest, pullRequestRequest]);
      if (active) setState({ key, repositories, invitations: invitationResult.invitations, pullRequests: pullRequestResult.pullRequests,
        repositoryError: false, invitationError: invitationResult.error, pullRequestError: pullRequestResult.error });
    }

    void load().catch(() => { if (active) setState({ key, repositories: [], invitations: [], pullRequests: [], repositoryError: true, invitationError: true, pullRequestError: true }); });
    return () => { active = false; };
  }, [authLoading, user, key]);

  const repositories = useMemo(() => state?.key === key ? state.repositories : [], [state, key]);
  const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
  const filteredRepositories = useMemo(() => repositories.filter((repository) => !normalizedQuery ||
    repository.name.toLocaleLowerCase("vi-VN").includes(normalizedQuery) ||
    (repository.description ?? "").toLocaleLowerCase("vi-VN").includes(normalizedQuery)), [repositories, normalizedQuery]);

  if (authLoading || !user) return null;
  if (state?.key !== key) return <div className={styles.dashboard}><div className="container"><div className={styles.loading} role="status"><span />Đang chuẩn bị dashboard…</div></div></div>;

  const privateCount = repositories.filter((repository) => repository.visibility === "PRIVATE").length;

  return <div className={styles.dashboard}>
    <div className="container">
      <header className={styles.welcome}>
        <div><span className="eyebrow">Dashboard</span><h1>{greeting()}, {user.username}</h1><p>Tiếp tục công việc đang dang dở hoặc bắt đầu một repository mới.</p></div>
        <Link className="button buttonPrimary" href="/new"><span aria-hidden="true">＋</span>Tạo repository</Link>
      </header>

      <section className={styles.stats} aria-label="Tổng quan">
        <article><span>Repository</span><strong>{state.repositoryError ? "—" : repositories.length}</strong><small>{state.repositoryError ? "Chưa thể đồng bộ" : `${privateCount} riêng tư`}</small></article>
        <article><span>Pull request gần đây</span><strong>{state.pullRequestError ? "—" : state.pullRequests.length}</strong><small>{state.pullRequestError ? "Chưa thể đồng bộ" : `Trong ${Math.min(repositories.length, 8)} repository mới nhất`}</small></article>
        <article><span>Lời mời</span><strong>{state.invitationError ? "—" : state.invitations.length}</strong><small>{state.invitationError ? "Chưa thể đồng bộ" : "Đang chờ phản hồi"}</small></article>
      </section>

      <div className={styles.workspace}>
        <div className={styles.primaryColumn}>
          <section className={styles.panel} aria-labelledby="your-repositories-title">
            <div className={styles.panelHeader}>
              <div><h2 id="your-repositories-title">Repository của bạn</h2><p>Truy cập nhanh những dự án gần đây.</p></div>
              <Link href={`/${encodeURIComponent(user.username)}`}>Xem tất cả <span aria-hidden="true">→</span></Link>
            </div>
            <label className={styles.repoSearch}><span className="srOnly">Lọc repository của bạn</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong repository của bạn" type="search" /></label>
            {state.repositoryError ? <InlineError onRetry={() => setAttempt((value) => value + 1)} /> : filteredRepositories.length ? <ul className={styles.repoList}>{filteredRepositories.slice(0, 6).map((repository) => <li key={repository.id}>
              <span className={styles.repoIcon}><RepoIcon /></span>
              <div><Link href={repositoryPath(repository)}>{repository.name}</Link><p>{repository.description || "Chưa có mô tả cho repository này."}</p><small>Cập nhật {formatDate(repository.updatedAt)}</small></div>
              <span className={repository.visibility === "PRIVATE" ? styles.privateBadge : styles.publicBadge}>{repository.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</span>
            </li>)}</ul> : <div className={styles.emptyState}><span className={styles.repoIcon}><RepoIcon /></span><div><h3>{query ? "Không tìm thấy repository" : "Bắt đầu repository đầu tiên"}</h3><p>{query ? "Thử một từ khóa khác." : "Tạo repository để lưu trữ và cộng tác trên mã nguồn."}</p></div>{!query && <Link className="button buttonSecondary buttonSmall" href="/new">Tạo repository</Link>}</div>}
          </section>

          <section className={styles.panel} aria-labelledby="open-pulls-title">
            <div className={styles.panelHeader}><div><h2 id="open-pulls-title">Pull request đang mở</h2><p>Những thay đổi gần đây trong repository của bạn.</p></div></div>
            {state.pullRequestError ? <InlineError onRetry={() => setAttempt((value) => value + 1)} /> : state.pullRequests.length ? <ul className={styles.pullList}>{state.pullRequests.slice(0, 6).map((pullRequest) => <li key={pullRequest.id}>
              <span className={styles.pullIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v8a4 4 0 0 0 4 4h6M18 17V9a4 4 0 0 0-4-4h-2m3-3-3 3 3 3" /></svg></span>
              <div><Link href={`${repositoryPath(pullRequest.repository)}/pulls/${pullRequest.number}`}>{pullRequest.title}</Link><p>{pullRequest.repository.name} <span>#{pullRequest.number}</span> · {pullRequest.author.username}</p></div><small>{formatDate(pullRequest.updatedAt)}</small>
            </li>)}</ul> : <div className={styles.quietState}><span aria-hidden="true">✓</span><div><h3>Không có pull request đang mở</h3><p>Mọi thay đổi hiện đã được xử lý.</p></div></div>}
          </section>
        </div>

        <aside className={styles.sideColumn}>
          <section className={styles.panel} aria-labelledby="invitations-title">
            <div className={styles.panelHeader}><div><h2 id="invitations-title">Lời mời cộng tác</h2><p>Repository đang chờ bạn phản hồi.</p></div><Link href="/invitations">Xem tất cả</Link></div>
            {state.invitationError ? <InlineError onRetry={() => setAttempt((value) => value + 1)} /> : state.invitations.length ? <ul className={styles.invitationList}>{state.invitations.slice(0, 3).map((invitation) => <li key={invitation.id}>
              <span>{invitation.repository.owner.username.slice(0, 1).toUpperCase()}</span><div><Link href="/invitations">{invitation.repository.owner.username}/{invitation.repository.name}</Link><p>{invitation.inviter.username} mời bạn với quyền {invitation.role === "WRITE" ? "ghi" : "đọc"}.</p></div>
            </li>)}</ul> : <div className={styles.quietState}><span aria-hidden="true">✓</span><div><h3>Không có lời mời mới</h3><p>Bạn đã xử lý tất cả lời mời.</p></div></div>}
          </section>

          <section className={`${styles.panel} ${styles.quickPanel}`} aria-labelledby="quick-actions-title">
            <div className={styles.panelHeader}><div><h2 id="quick-actions-title">Thao tác nhanh</h2></div></div>
            <nav aria-label="Thao tác nhanh"><Link href="/new"><span aria-hidden="true">＋</span><div><strong>Tạo repository</strong><small>Khởi tạo một dự án mới</small></div><i aria-hidden="true">→</i></Link><Link href="/settings/tokens"><span aria-hidden="true">⌁</span><div><strong>Personal access token</strong><small>Quản lý quyền truy cập Git</small></div><i aria-hidden="true">→</i></Link><Link href="/invitations"><span aria-hidden="true">✉</span><div><strong>Lời mời cộng tác</strong><small>Xem các lời mời đang chờ</small></div><i aria-hidden="true">→</i></Link></nav>
          </section>
        </aside>
      </div>
    </div>
  </div>;
}

function InlineError({ onRetry }: { onRetry: () => void }) {
  return <div className={styles.inlineError}><p>Chưa thể đồng bộ dữ liệu.</p><button type="button" onClick={onRetry}>Thử lại</button></div>;
}
