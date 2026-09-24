"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import styles from "./profile.module.css";

export function RepositoryList({ username, initial }: { username: string; initial: RepositorySummary[] }) {
  const { user, loading } = useAuth();
  const [owned, setOwned] = useState<{ username: string; repositories: RepositorySummary[] } | null>(null);
  const isOwner = user?.username.toLowerCase() === username.toLowerCase();
  const repositories = isOwner && owned?.username === username ? owned.repositories : initial;
  useEffect(() => {
    if (loading || !isOwner) return;
    let active = true;
    fetch(`/api/v1/users/${encodeURIComponent(username)}`, { credentials: "include", cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Không thể tải repository."); return response.json(); })
      .then((data: { repositories: RepositorySummary[] }) => { if (active) setOwned({ username, repositories: data.repositories }); })
      .catch(() => {});
    return () => { active = false; };
  }, [isOwner, loading, username]);

  if (!repositories.length) return <div className={styles.empty}>
    <span className={styles.repoIcon} aria-hidden="true">&lt;/&gt;</span>
    <h3>Chưa có repository</h3>
    <p>Repository công khai của thành viên sẽ xuất hiện ở đây.</p>
    <Link className="button buttonSecondary" href="/">Khám phá Code Forge</Link>
  </div>;
  return <ul className={styles.repoList}>{repositories.map((repo) => <li key={repo.id}>
    <div><Link href={repositoryPath(repo)}>{repo.name}</Link><span className="badge">{repo.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</span></div>
    {repo.description && <p>{repo.description}</p>}
  </li>)}</ul>;
}
