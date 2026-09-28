"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./repository.module.css";

type Entry = { name: string; path: string; type: "directory" | "file" | "symlink" | "submodule"; navigable: boolean };
type Tree = { entries: Entry[]; storageState: string };
const labels = { directory: "Thư mục", file: "Tệp", symlink: "Liên kết tượng trưng", submodule: "Submodule" };
const errors: Record<string, string> = {
  PATH_NOT_FOUND: "Đường dẫn không tồn tại trên branch này.",
  PATH_NOT_DIRECTORY: "Đường dẫn này không phải thư mục.",
  INVALID_PATH: "Đường dẫn mã nguồn không hợp lệ.",
  REF_NOT_FOUND: "Branch không tồn tại hoặc đã bị xóa.",
  GIT_READ_LIMIT_EXCEEDED: "Thư mục vượt giới hạn hiển thị 1000 mục.",
};

export function TreeBrowser({ endpoint, refName, children }: { endpoint: string; refName: string | null; children?: ReactNode }) {
  const query = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const path = query.get("path") ?? "";
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([endpoint, refName, path, user?.id, attempt]);
  const [result, setResult] = useState<{ key: string; data?: Tree; error?: string }>({ key: "" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ path });
    if (refName !== null) params.set("ref", refName);
    sessionFetch(`${endpoint}/tree?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(errors[body.error?.code] ?? (response.status === 404 ? "Repository không tồn tại hoặc bạn không có quyền xem." : "Chưa thể tải cây thư mục. Vui lòng thử lại."));
        if (active) setResult({ key, data: body });
      }).catch((error) => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Không thể tải thư mục." }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, refName, path, key]);

  function href(nextPath: string) {
    const next = new URLSearchParams(query.toString());
    if (refName !== null) next.set("ref", refName);
    if (nextPath) next.set("path", nextPath); else next.delete("path");
    return `${pathname}${next.size ? `?${next}` : ""}`;
  }
  const parts = path ? path.split("/") : [];
  return <section className={styles.source} aria-label="Cây thư mục">
    <nav className={styles.breadcrumb} aria-label="Đường dẫn mã nguồn">
      <Link href={href("")} scroll={false} aria-current={!path ? "page" : undefined}>Gốc</Link>
      {parts.map((part, i) => <span key={i}> / {i === parts.length - 1 ? <strong aria-current="page">{part}</strong> : <Link href={href(parts.slice(0, i + 1).join("/"))} scroll={false}>{part}</Link>}</span>)}
    </nav>
    {path && <Link className={styles.parentLink} href={href(parts.slice(0, -1).join("/"))} scroll={false}>← Thư mục cha</Link>}
    {result.key !== key ? <p role="status">Đang tải cây thư mục…</p> : !result.data ? <div className={styles.empty}>
      <p role="alert">{result.error}</p>
      <button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>Tải lại thư mục</button>
      {path && <Link href={href("")} scroll={false}>Về thư mục gốc</Link>}
    </div> : <>
      {result.data.storageState === "RESET" && <p className={styles.notice}>Git storage đã được khởi tạo lại; mã nguồn trước đó không còn.</p>}
      {result.data.entries.length ? <ul className={styles.treeList}>
        {result.data.entries.map((entry) => <li key={entry.path}>
          {entry.type === "directory" && entry.navigable ? <Link href={href(entry.path)} scroll={false}>{entry.name}/</Link> : <span>{entry.name}{entry.type === "directory" ? "/" : ""}</span>}
          <small>{labels[entry.type]}{entry.type === "directory" && !entry.navigable ? " · Đường dẫn không được hỗ trợ" : ""}</small>
        </li>)}
      </ul> : <p className={styles.treeEmpty}>Thư mục chưa có nội dung.</p>}
      {!path && result.data.storageState === "READY" && children}
    </>}
  </section>;
}
