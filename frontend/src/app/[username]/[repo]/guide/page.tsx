"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { QuickSetup } from "../quick-setup";
import { RepositoryNavigation } from "@/components/repository-navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import type { RepositorySummary } from "@/lib/repositories";
import styles from "../repository.module.css";

type Repository = RepositorySummary & { defaultBranch: string; createdAt: string; status: string; storageState?: "READY" | "EMPTY" | "RESET"; readme?: string | null };

export default function RepositoryPage() {
  const params = useParams<{ username: string; repo: string }>();
  const { loading, user } = useAuth();
  const [result, setResult] = useState<{ repository: Repository | null; error: "not-found" | "unavailable" | null; key: string }>({ repository: null, error: null, key: "" });
  const [attempt, setAttempt] = useState(0);
  const key = `${params.username}/${params.repo}/${user?.id ?? "anonymous"}`;

  useEffect(() => {
    if (loading) return;
    let active = true;
    sessionFetch(`/api/v1/repos/${encodeURIComponent(params.username)}/${encodeURIComponent(params.repo)}`, { cache: "no-store" })
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
    <div className={styles.repositoryTitle}>
      <Link href={`/${encodeURIComponent(repo.owner.username)}`}>{repo.owner.username}</Link><span aria-hidden="true"> / </span><h1>{repo.name}</h1>
      <span className="badge">{repo.visibility === "PRIVATE" ? "Riêng tư" : "Công khai"}</span>
    </div>
    <RepositoryNavigation owner={repo.owner.username} repository={repo.name} current="guide" canManage={repo.permissions?.canManage ?? false} />
    {repo.storageState === "RESET" && <div className={styles.notice} role="status">Kho lưu trữ Git đã được khởi tạo lại. Hãy khôi phục các branch và tag từ một bản sao tin cậy trước khi tiếp tục làm việc.</div>}
    <QuickSetup repository={repo} />
  </main>;
}
