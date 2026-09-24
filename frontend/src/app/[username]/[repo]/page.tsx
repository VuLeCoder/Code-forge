"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import styles from "./repository.module.css";

type Repository = RepositorySummary & { defaultBranch: string; createdAt: string; status: string };

export default function RepositoryPage() {
  const params = useParams<{ username: string; repo: string }>();
  const { loading } = useAuth();
  const [result, setResult] = useState<{ repository: Repository | null; error: "not-found" | "unavailable" | null; key: string }>({ repository: null, error: null, key: "" });
  const [attempt, setAttempt] = useState(0);
  const key = `${params.username}/${params.repo}`;

  useEffect(() => {
    if (loading) return;
    let active = true;
    fetch(`/api/v1/repos/${encodeURIComponent(params.username)}/${encodeURIComponent(params.repo)}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return { repository: null, error: "not-found" as const, key };
        if (!response.ok) throw new Error("Không thể tải repository.");
        const body = await response.json() as { repository: Repository };
        return { repository: body.repository, error: null, key };
      })
      .then((next) => { if (active) setResult(next); })
      .catch(() => { if (active) setResult({ repository: null, error: "unavailable", key }); });
    return () => { active = false; };
  }, [loading, params.username, params.repo, key, attempt]);

  if (loading || result.key !== key) return <main className={`container ${styles.page}`}><p role="status">Đang tải repository…</p></main>;
  if (result.error === "not-found") return <main className={`container ${styles.page}`}><h1>Không tìm thấy repository</h1><p>Repository không tồn tại hoặc bạn không có quyền xem.</p><Link className="button buttonSecondary" href="/">Khám phá repository</Link></main>;
  if (result.error || !result.repository) return <main className={`container ${styles.page}`}><h1>Chưa thể tải repository</h1><p>Vui lòng thử lại sau.</p><button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></main>;

  const repo = result.repository;
  return <main className={`container ${styles.page}`}>
    <div className={styles.breadcrumb}><Link href={`/${encodeURIComponent(repo.owner.username)}`}>{repo.owner.username}</Link><span>/</span><strong>{repo.name}</strong><span className="badge">{repo.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</span></div>
    <div className={styles.header}><div><span className="eyebrow">Repository</span><h1>{repo.name}</h1>{repo.description && <p>{repo.description}</p>}</div></div>
    <section className={styles.empty} aria-labelledby="empty-title"><span className={styles.icon} aria-hidden="true">&lt;/&gt;</span><h2 id="empty-title">Repository chưa có mã nguồn</h2><p>Repository này hiện chưa có tệp nào.</p><div className={styles.details}><span>Nhánh mặc định</span><strong>{repo.defaultBranch}</strong></div></section>
    <div className={styles.bottom}><Link href={repositoryPath(repo)}>Repository</Link><Link href={`/${encodeURIComponent(repo.owner.username)}`}>Hồ sơ {repo.owner.username}</Link></div>
  </main>;
}
