"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { sessionFetch } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";
import { Avatar } from "@/components/avatar";
import { RepositoryIcon } from "./repository-icon";
import styles from "./repository.module.css";
type Overview = { commit: { sha: string; subject: string; committedAt: string } | null; commitCount: number; update: { username: string; kind: string; avatarUrl?: string | null } | null };
export function RepositoryOverview({ endpoint, refName }: { endpoint: string; refName: string }) {
  const pathname = usePathname(); const { user } = useAuth();
  const [attempt, retry] = useState(0); const [now, setNow] = useState(() => Date.now());
  const key = JSON.stringify([endpoint, refName, user?.id, attempt]);
  const [result, setResult] = useState<{ key: string; data?: Overview; error?: string }>({ key: "" });
  const [copyMessage, setCopyMessage] = useState("");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { const controller = new AbortController(); let active = true;
    sessionFetch(`${endpoint}/overview?ref=${encodeURIComponent(refName)}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Chưa thể tải tổng quan commit.");
      const data = await response.json() as Overview; if (active) setResult({ key, data });
    }).catch(error => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Không thể tải commit." }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, refName, key]);
  if (result.key !== key) return <p role="status">Đang tải tổng quan commit…</p>;
  if (!result.data) return <p role="alert">{result.error} <button onClick={() => retry(value => value + 1)}>Thử lại</button></p>;
  const { commit, update, commitCount } = result.data; if (!commit) return null;
  const detail = `${pathname}?${new URLSearchParams({ ref: refName, view: "commit", sha: commit.sha })}`;
  const delta = (new Date(commit.committedAt).getTime() - now) / 1000;
  const unit = Math.abs(delta) >= 86400 ? "day" : Math.abs(delta) >= 3600 ? "hour" : "minute";
  const relative = new Intl.RelativeTimeFormat("vi", { numeric: "auto" }).format(Math.round(delta / (unit === "day" ? 86400 : unit === "hour" ? 3600 : 60)), unit);
  return <div className={styles.overview}>
    {update ? <span className={styles.pushIdentity}><Avatar className={styles.pushAvatar} username={update.username} avatarUrl={user?.username === update.username ? user.avatarUrl : update.avatarUrl} /><Link href={`/${encodeURIComponent(update.username)}`}>{update.username}</Link> {update.kind !== "PUSH" && <small>{update.kind === "MERGE" ? "đã merge" : update.kind === "INITIALIZE" ? "đã khởi tạo" : ""}</small>}</span> : <span className={styles.unknownPusher}>Chưa có dữ liệu người push</span>}
    <Link className={styles.commitSubject} title={commit.subject} href={detail}>{commit.subject || "(Không có thông điệp)"}</Link>
    <div className={styles.commitMetadata}><Link href={detail}><code>{commit.sha.slice(0, 7)}</code></Link>
    <button className={styles.overviewCopy} aria-label="Sao chép SHA" title={commit.sha} onClick={async () => { try { await navigator.clipboard.writeText(commit.sha); setCopyMessage("Đã sao chép SHA."); } catch { setCopyMessage("Không thể sao chép SHA: " + commit.sha); } }}><RepositoryIcon name="copy" /></button>
    <time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString("vi-VN")}>{relative}</time></div>
    <Link className={styles.commitCount} href={`${pathname}?${new URLSearchParams({ ref: refName, view: "commits", snapshot: commit.sha })}`}><RepositoryIcon name="history" /><span>{commitCount} commit</span></Link>
    <span className={styles.copyFeedback} role="status">{copyMessage}</span>
  </div>;
}
