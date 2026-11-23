"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import { CommitChanges, type CommitChangesData } from "./commit-changes";
import { RepositoryIcon } from "./repository-icon";
import styles from "./repository.module.css";

type Commit = { sha: string; parentShas: string[]; subject: string; message: string;
  author: { name: string; email: string }; authoredAt: string;
  committer: { name: string; email: string }; committedAt: string; changes?: CommitChangesData };
type History = { commits: Commit[]; page: number; hasMore: boolean; snapshot: string | null; storageState: string };
const errors: Record<string, string> = {
  INVALID_COMMIT_FILTER: "Tác giả hoặc khoảng ngày không hợp lệ. Ngày kết thúc phải từ ngày bắt đầu trở đi.",
  INVALID_SHA: "SHA commit không hợp lệ. Cần SHA đầy đủ.",
  INVALID_PAGE: "Trang lịch sử phải từ 1 đến 1000.",
  COMMIT_NOT_FOUND: "Commit không tồn tại trong lịch sử hiện tại. Branch hoặc storage có thể đã thay đổi.",
  REF_NOT_FOUND: "Branch không tồn tại hoặc đã bị xóa.",
  INVALID_REF: "Tên branch không hợp lệ.",
};

function CommitTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString("vi-VN", { timeZone: "UTC" })} UTC</time>;
}

export function CommitBrowser({ endpoint, detail = false }: { endpoint: string; detail?: boolean }) {
  const [copyMessage, setCopyMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const query = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const params = new URLSearchParams();
  for (const name of ["ref", "page", "snapshot", "author", "since", "until"]) for (const value of query.getAll(name)) params.append(name, value);
  const sha = query.get("sha") ?? "";
  const url = detail ? `${endpoint}/commits/${encodeURIComponent(sha || "invalid")}` : `${endpoint}/commits?${params}`;
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([url, user?.id, attempt]);
  const [result, setResult] = useState<{ key: string; data?: History | { commit: Commit }; error?: string }>({ key: "" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    sessionFetch(url, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(errors[body.error?.code] ?? (response.status === 404 ? "Repository không tồn tại hoặc bạn không có quyền xem." : "Chưa thể tải commit. Vui lòng thử lại."));
      if (active) setResult({ key, data: body });
    }).catch((error) => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Không thể tải commit." }); });
    return () => { active = false; controller.abort(); };
  }, [url, key]);

  function href(commitSha?: string, page?: number, snapshot?: string | null) {
    const next = new URLSearchParams();
    if (query.has("ref")) next.set("ref", query.get("ref")!);
    for (const name of ["author", "since", "until"]) if (query.has(name)) next.set(name, query.get(name)!);
    next.set("view", commitSha ? "commit" : "commits");
    if (commitSha) next.set("sha", commitSha);
    // Keep list position when opening a commit and following its parents.
    if (page !== undefined) next.set("page", String(page));
    else if (query.has("page")) next.set("page", query.get("page")!);
    if (snapshot) next.set("snapshot", snapshot);
    else if (query.has("snapshot")) next.set("snapshot", query.get("snapshot")!);
    return `${pathname}?${next}`;
  }
  const data = result.key === key ? result.data : undefined;
  const groups = new Map<string, Commit[]>();
  if (data && "commits" in data) for (const commit of data.commits) {
    const day = new Date(commit.committedAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "numeric", month: "long", year: "numeric" });
    groups.set(day, [...(groups.get(day) ?? []), commit]);
  }
  function relative(value: string) {
    const seconds = (new Date(value).getTime() - now) / 1000;
    const unit = Math.abs(seconds) >= 86400 ? "day" : Math.abs(seconds) >= 3600 ? "hour" : "minute";
    return new Intl.RelativeTimeFormat("vi", { numeric: "auto" }).format(Math.round(seconds / (unit === "day" ? 86400 : unit === "hour" ? 3600 : 60)), unit);
  }
  return <section className={detail ? styles.commitPanel : styles.commitHistory} aria-label={detail ? "Chi tiết commit" : "Lịch sử commit"}>
    {detail && <h2>Chi tiết commit</h2>}
    {detail && <Link href={href()}>← Về lịch sử commit</Link>}
    {result.key !== key ? <p role="status">Đang tải commit…</p> : !data ? <div>
      <p role="alert">{result.error}</p>
      <button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>Tải lại commit</button>
      <Link href={`${pathname}?view=commits`}>Về lịch sử mặc định</Link>
    </div> : "commit" in data ? <>
      <h3>{data.commit.subject || "(Không có thông điệp)"}</h3>
      <dl className={styles.commitDetails}>
        <dt>Tác giả</dt><dd>{data.commit.author.name} &lt;{data.commit.author.email}&gt;</dd>
        <dt>Thời gian tác giả</dt><dd><CommitTime value={data.commit.authoredAt} /></dd>
        {(data.commit.author.name !== data.commit.committer.name || data.commit.author.email !== data.commit.committer.email) && <>
          <dt>Người ghi commit</dt><dd>{data.commit.committer.name} &lt;{data.commit.committer.email}&gt;</dd>
        </>}
        {new Date(data.commit.authoredAt).getTime() !== new Date(data.commit.committedAt).getTime() && <>
          <dt>Thời gian commit</dt><dd><CommitTime value={data.commit.committedAt} /></dd>
        </>}
      </dl>
      <details key={`metadata-${data.commit.sha}`} className={styles.commitTechnicalDetails}>
        <summary>Thông tin chi tiết</summary>
        <dl className={styles.commitDetails}>
          <dt>SHA</dt><dd><code>{data.commit.sha}</code></dd>
          <dt>Tác giả</dt><dd>{data.commit.author.name} &lt;{data.commit.author.email}&gt;</dd>
          <dt>Thời gian tác giả</dt><dd><CommitTime value={data.commit.authoredAt} /></dd>
          <dt>Người ghi commit</dt><dd>{data.commit.committer.name} &lt;{data.commit.committer.email}&gt;</dd>
          <dt>Thời gian commit</dt><dd><CommitTime value={data.commit.committedAt} /></dd>
          <dt>Commit cha</dt><dd>{data.commit.parentShas.length ? data.commit.parentShas.map((parent) => <Link className={styles.parentCommit} key={parent} href={href(parent)}><code>{parent}</code></Link>) : "Commit đầu tiên, không có commit cha."}</dd>
        </dl>
      </details>
      <pre className={styles.commitMessage}>{data.commit.message || "(Không có thông điệp)"}</pre>
      <CommitChanges key={`changes-${data.commit.sha}`} changes={data.commit.changes} />
    </> : <>
      {data.storageState === "RESET" && <p className={styles.notice}>Git storage đã được khởi tạo lại; lịch sử trước đó không còn.</p>}
      {data.commits.length ? Array.from(groups, ([day, commits]) => <section className={styles.commitDay} key={day} aria-label={`Commit ngày ${day}`}>
        <h3><RepositoryIcon name="history" />{day}</h3>
        <ol className={styles.commitList}>{commits.map(commit => <li key={commit.sha}>
          <div className={styles.historyContent}>
            <Link className={styles.historySubject} href={href(commit.sha, data.page, data.snapshot)} title={commit.subject}>{commit.subject || "(Không có thông điệp)"}</Link>
            <div className={styles.historyAuthor}><span className={styles.historyAvatar} aria-hidden="true">{commit.author.name.slice(0, 1).toUpperCase()}</span><span title={commit.author.email}>{commit.author.name}</span><time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString("vi-VN")}>{relative(commit.committedAt)}</time></div>
          </div>
          <div className={styles.historyActions}>
            <Link href={href(commit.sha, data.page, data.snapshot)} title={commit.sha}><code>{commit.sha.slice(0, 7)}</code></Link>
            <button type="button" aria-label={`Sao chép SHA ${commit.sha.slice(0, 7)}`} onClick={async () => { try { await navigator.clipboard.writeText(commit.sha); setCopyMessage("Đã sao chép SHA."); } catch { setCopyMessage("Không thể sao chép SHA: " + commit.sha); } }}><RepositoryIcon name="copy" /></button>
          </div>
        </li>)}</ol>
      </section>) : <p>{data.page > 1 ? "Trang này không có commit." : ["author", "since", "until"].some(name => query.has(name)) ? "Không có commit phù hợp với bộ lọc." : "Chưa có commit trên branch này."}</p>}
      <span className={styles.copyFeedback} role="status">{copyMessage}</span>
      <nav className={styles.commitPagination} aria-label="Phân trang commit">
        {data.page > 1 && <Link href={href(undefined, data.page - 1, data.snapshot)}>Trang trước</Link>}
        <span>Trang {data.page}</span>
        {data.hasMore && data.page < 1000 && <Link href={href(undefined, data.page + 1, data.snapshot)}>Trang sau</Link>}
      </nav>
      {data.hasMore && data.page === 1000 && <p className={styles.notice}>Đã đạt giới hạn 1.000 trang. Lịch sử vẫn còn commit cũ hơn.</p>}
    </>}
  </section>;
}
