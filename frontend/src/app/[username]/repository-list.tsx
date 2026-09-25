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

  if (loading || (isOwner && owned?.key !== key)) return <div className={styles.empty}><p role="status">Đang tải repository…</p></div>;
  if (isOwner && owned?.error) return <div className={styles.empty}><p role="alert">Chưa thể tải danh sách repository. Vui lòng thử lại.</p><button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></div>;

  if (!repositories.length) return <div className={styles.empty}>
    <span className={styles.repoIcon} aria-hidden="true">&lt;/&gt;</span>
    <h3>Chưa có repository</h3>
    <p>{isOwner ? "Bạn chưa tạo repository nào." : "Repository công khai của thành viên sẽ xuất hiện ở đây."}</p>
    <Link className="button buttonSecondary" href={isOwner ? "/new" : "/"}>{isOwner ? "Tạo repository" : "Khám phá Code Forge"}</Link>
  </div>;
  return <ul className={styles.repoList}>{repositories.map((repo) => <li key={repo.id}>
    <div><Link href={repositoryPath(repo)}>{repo.name}</Link><span className="badge">{repo.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</span></div>
    {repo.description && <p>{repo.description}</p>}
  </li>)}</ul>;
}
