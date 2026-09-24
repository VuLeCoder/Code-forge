import { notFound } from "next/navigation";
import styles from "./profile.module.css";
import { RepositoryList } from "./repository-list";
import type { RepositorySummary } from "@/lib/repositories";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,37}[a-zA-Z0-9]$/.test(username)) notFound();
  let response: Response;
  try {
    response = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:4000"}/api/v1/users/${encodeURIComponent(username)}`, {
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Không thể tải hồ sơ lúc này.");
  }
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Không thể tải hồ sơ lúc này.");
  const { user, repositories } = await response.json() as { user: { username: string; createdAt: string }; repositories: RepositorySummary[] };
  return <main className={`container ${styles.layout}`}>
    <aside className={styles.identity}>
      <div className={styles.avatar} aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</div>
      <span className="eyebrow">Thành viên Code Forge</span>
      <h1>{user.username}</h1>
      <p>@{user.username}</p>
      <p className={styles.joined}>Tham gia {new Intl.DateTimeFormat("vi-VN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(user.createdAt))}</p>
    </aside>
    <section className={styles.repositories} aria-labelledby="repositories-title">
      <div className={styles.heading}><h2 id="repositories-title">Repository</h2></div>
      <RepositoryList username={user.username} initial={repositories ?? []} />
    </section>
  </main>;
}
