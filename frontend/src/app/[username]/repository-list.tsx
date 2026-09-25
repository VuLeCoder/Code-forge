"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import styles from "./profile.module.css";

export function RepositoryList({ username, initial }: { username: string; initial: RepositorySummary[] }) {
  const { user, loading } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [owned, setOwned] = useState<{ key: string; repositories: RepositorySummary[]; error: boolean } | null>(null);
  const [deleted, setDeleted] = useState<{ key: string; repositories: RepositorySummary[]; error: boolean } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState("");
  const key = `${user?.id ?? ""}/${username}/${attempt}`;
  const isOwner = user?.username.toLowerCase() === username.toLowerCase();
  const repositories = isOwner && owned?.key === key ? owned.repositories : initial;
  useEffect(() => {
    if (loading || !isOwner) return;
    let active = true;
    sessionFetch(`/api/v1/users/${encodeURIComponent(username)}`, { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Không thể tải repository."); return response.json(); })
      .then((data: { repositories: RepositorySummary[] }) => { if (active) setOwned({ key, repositories: data.repositories, error: false }); })
      .catch(() => { if (active) setOwned({ key, repositories: [], error: true }); });
    return () => { active = false; };
  }, [isOwner, loading, username, key]);

  useEffect(() => {
    if (loading || !isOwner) return;
    let active = true;
    sessionFetch("/api/v1/repositories/deleted", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Không thể tải repository đã xóa."); return response.json(); })
      .then((data: { repositories: RepositorySummary[] }) => { if (active) setDeleted({ key, repositories: data.repositories, error: false }); })
      .catch(() => { if (active) setDeleted({ key, repositories: [], error: true }); });
    return () => { active = false; };
  }, [isOwner, loading, key]);

  async function restore(repo: RepositorySummary) {
    if (restoring) return;
    setRestoring(repo.id); setRestoreMessage("");
    try {
      const response = await sessionFetch(`/api/v1/repos/${encodeURIComponent(repo.owner.username)}/${encodeURIComponent(repo.name)}/restore`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
        throw new Error(body.error?.code === "RESTORE_EXPIRED" ? "Đã hết thời hạn khôi phục repository." : body.error?.message ?? "Không thể khôi phục repository.");
      }
      setRestoreMessage(`Đã khôi phục ${repo.name}.`);
      setAttempt((value) => value + 1);
    } catch (error) { setRestoreMessage(error instanceof Error ? error.message : "Không thể khôi phục repository."); }
    finally { setRestoring(null); }
  }

  if (loading || (isOwner && owned?.key !== key)) return <div className={styles.empty}><p role="status">Đang tải repository…</p></div>;
  if (isOwner && owned?.error) return <div className={styles.empty}><p role="alert">Chưa thể tải danh sách repository. Vui lòng thử lại.</p><button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></div>;

  const activeContent = !repositories.length ? <div className={styles.empty}>
    <span className={styles.repoIcon} aria-hidden="true">&lt;/&gt;</span>
    <h3>Chưa có repository</h3>
    <p>{isOwner ? "Bạn chưa tạo repository nào." : "Repository công khai của thành viên sẽ xuất hiện ở đây."}</p>
    <Link className="button buttonSecondary" href={isOwner ? "/new" : "/"}>{isOwner ? "Tạo repository" : "Khám phá Code Forge"}</Link>
  </div> : <ul className={styles.repoList}>{repositories.map((repo) => <li key={repo.id}>
    <div><Link href={repositoryPath(repo)}>{repo.name}</Link><span className="badge">{repo.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</span></div>
    {repo.description && <p>{repo.description}</p>}
  </li>)}</ul>;

  return <>
    {activeContent}
    {isOwner && <section className={styles.deletedSection} aria-labelledby="deleted-title">
      <h3 id="deleted-title">Repository đã xóa</h3>
      <p>Repository được giữ đến hết thời hạn bên dưới rồi xóa vĩnh viễn.</p>
      {restoreMessage && <p role="status">{restoreMessage}</p>}
      {deleted?.key !== key ? <p role="status">Đang tải repository đã xóa…</p> : deleted.error ?
        <p role="alert">Chưa thể tải repository đã xóa. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></p> :
        deleted.repositories.length === 0 ? <p>Không có repository đang chờ xóa.</p> :
        <ul className={styles.deletedList}>{deleted.repositories.map((repo) => <li key={repo.id}>
          <div><strong>{repo.name}</strong><span>Khôi phục trước {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(repo.purgeAfter!))}</span></div>
          <button className="button buttonSecondary" type="button" disabled={restoring !== null} onClick={() => restore(repo)}>{restoring === repo.id ? "Đang khôi phục…" : "Khôi phục"}</button>
        </li>)}</ul>}
    </section>}
  </>;
}
