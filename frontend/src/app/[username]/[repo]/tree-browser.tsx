"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./repository.module.css";
import { BlobViewer, type BlobData } from "./blob-viewer";
import { ReadmeViewer } from "./readme-viewer";

type Entry = { name: string; path: string; type: "directory" | "file" | "symlink" | "submodule"; navigable: boolean };
type Tree = { entries: Entry[]; storageState: string };
const labels = { directory: "Thư mục", file: "Tệp", symlink: "Liên kết tượng trưng", submodule: "Submodule" };
const errors: Record<string, string> = {
  PATH_NOT_FOUND: "Đường dẫn không tồn tại trên branch này.",
  PATH_NOT_DIRECTORY: "Đường dẫn này không phải thư mục.",
  PATH_NOT_FILE: "Đường dẫn này không phải file thông thường. Không thể mở thư mục, symlink hoặc submodule như file.",
  INVALID_PATH: "Đường dẫn mã nguồn không hợp lệ.",
  REF_NOT_FOUND: "Branch không tồn tại hoặc đã bị xóa.",
  GIT_READ_LIMIT_EXCEEDED: "Thư mục vượt giới hạn hiển thị 1000 mục.",
};

export function TreeBrowser({ endpoint, refName }: { endpoint: string; refName: string | null }) {
  const query = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const path = query.get("path") ?? "";
  const isBlob = query.get("view") === "blob";
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([endpoint, refName, path, isBlob, user?.id, attempt]);
  const [result, setResult] = useState<{ key: string; data?: Tree | BlobData; error?: string }>({ key: "" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ path });
    if (refName !== null) params.set("ref", refName);
    sessionFetch(`${endpoint}/${isBlob ? "blob" : "tree"}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(errors[body.error?.code] ?? (response.status === 404 ? "Repository không tồn tại hoặc bạn không có quyền xem." : "Chưa thể tải mã nguồn. Vui lòng thử lại."));
        if (active) setResult({ key, data: body });
      }).catch((error) => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Không thể tải thư mục." }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, refName, path, isBlob, key]);

  function href(nextPath: string, blob = false) {
    const next = new URLSearchParams(query.toString());
    if (blob) next.set("view", "blob"); else next.delete("view");
    if (refName !== null) next.set("ref", refName);
    if (nextPath) next.set("path", nextPath); else next.delete("path");
    return `${pathname}${next.size ? `?${next}` : ""}`;
  }
  const parts = path ? path.split("/") : [];
  return <section className={styles.source} aria-label={isBlob ? "Nội dung file" : "Cây thư mục"}>
    <nav className={styles.breadcrumb} aria-label="Đường dẫn mã nguồn">
      <Link href={href("")} scroll={false} aria-current={!path ? "page" : undefined}>Gốc</Link>
      {parts.map((part, i) => <span key={i}> / {i === parts.length - 1 ? <strong aria-current="page">{part}</strong> : <Link href={href(parts.slice(0, i + 1).join("/"))} scroll={false}>{part}</Link>}</span>)}
    </nav>
    {path && <Link className={styles.parentLink} href={href(parts.slice(0, -1).join("/"))} scroll={false}>← Thư mục cha</Link>}
    {result.key !== key ? <p role="status">{isBlob ? "Đang tải file…" : "Đang tải cây thư mục…"}</p> : !result.data ? <div className={styles.empty}>
      <p role="alert">{result.error}</p>
      <button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>{isBlob ? "Tải lại file" : "Tải lại thư mục"}</button>
      {path && <Link href={href("")} scroll={false}>Về thư mục gốc</Link>}
    </div> : "kind" in result.data ? <BlobViewer data={result.data} /> : <>
      {result.data.storageState === "RESET" && <p className={styles.notice}>Git storage đã được khởi tạo lại; mã nguồn trước đó không còn.</p>}
      {result.data.entries.length ? <ul className={styles.treeList}>
        {result.data.entries.map((entry) => <li key={entry.path}>
          {entry.navigable && (entry.type === "directory" || entry.type === "file") ? <Link href={href(entry.path, entry.type === "file")} scroll={false}>{entry.name}{entry.type === "directory" ? "/" : ""}</Link> : <span>{entry.name}{entry.type === "directory" ? "/" : ""}</span>}
          <small>{labels[entry.type]}{entry.type === "directory" && !entry.navigable ? " · Đường dẫn không được hỗ trợ" : ""}</small>
        </li>)}
      </ul> : <p className={styles.treeEmpty}>Thư mục chưa có nội dung.</p>}
      {refName && result.data.storageState === "READY" && <ReadmeViewer key={key} endpoint={endpoint} refName={refName} filePath={
        ["readme.md", "readme.markdown", "readme"].flatMap((name) => result.data && "entries" in result.data ? result.data.entries.filter((entry) => entry.type === "file" && entry.navigable && entry.name.toLowerCase() === name) : [])[0]?.path ?? null
      } />}
    </>}
  </section>;
}
