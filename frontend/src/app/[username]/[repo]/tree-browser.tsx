"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./repository.module.css";
import { BlobViewer, type BlobData } from "./blob-viewer";
import { ReadmeViewer } from "./readme-viewer";

type Entry = {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "submodule";
  navigable: boolean;
  lastCommit?: { sha: string; subject: string; committedAt: string; authorName: string } | null;
};
type Tree = { entries: Entry[]; storageState: string };
const labels = {
  directory: "Thư mục",
  file: "Tệp",
  symlink: "Liên kết tượng trưng",
  submodule: "Submodule",
};
const errors: Record<string, string> = {
  PATH_NOT_FOUND: "Đường dẫn không tồn tại trên branch này.",
  PATH_NOT_DIRECTORY: "Đường dẫn này không phải thư mục.",
  PATH_NOT_FILE:
    "Đường dẫn này không phải file thông thường. Không thể mở thư mục, symlink hoặc submodule như file.",
  INVALID_PATH: "Đường dẫn mã nguồn không hợp lệ.",
  REF_NOT_FOUND: "Branch không tồn tại hoặc đã bị xóa.",
  GIT_READ_LIMIT_EXCEEDED: "Thư mục vượt giới hạn hiển thị 1000 mục.",
};

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={styles.folderIcon}
    >
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
    </svg>
  );
}

function FileIcon({ tone }: { tone: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={`${styles.fileIcon} ${tone}`}
    >
      <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm7.5.793V4.25c0 .138.112.25.25.25h2.457Z" />
    </svg>
  );
}

function fileTone(name: string) {
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(name)) return styles.fileIconCode;
  if (/\.json$/i.test(name)) return styles.fileIconJson;
  if (/\.(?:md|mdx|txt)$/i.test(name)) return styles.fileIconDocs;
  if (/\.(?:css|scss|sass)$/i.test(name)) return styles.fileIconStyle;
  if (/\.(?:ya?ml|toml|env|conf|ini)$/i.test(name)) return styles.fileIconConfig;
  return styles.fileIcon;
}

function relativeTime(date: string) {
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86400000);
  return new Intl.RelativeTimeFormat("vi", { numeric: "auto" }).format(days, "day");
}

export function TreeBrowser({
  endpoint,
  refName,
}: {
  endpoint: string;
  refName: string | null;
}) {
  const query = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const path = query.get("path") ?? "";
  const isBlob = query.get("view") === "blob";
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([
    endpoint,
    refName,
    path,
    isBlob,
    user?.id,
    attempt,
  ]);
  const [result, setResult] = useState<{
    key: string;
    data?: Tree | BlobData;
    error?: string;
  }>({ key: "" });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({ path });
    if (refName !== null) params.set("ref", refName);
    sessionFetch(`${endpoint}/${isBlob ? "blob" : "tree"}?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            errors[body.error?.code] ??
              (response.status === 404
                ? "Repository không tồn tại hoặc bạn không có quyền xem."
                : "Chưa thể tải mã nguồn. Vui lòng thử lại."),
          );
        if (active) setResult({ key, data: body });
      })
      .catch((error) => {
        if (active)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : "Không thể tải thư mục.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [endpoint, refName, path, isBlob, key]);

  function href(nextPath: string, blob = false) {
    const next = new URLSearchParams(query.toString());
    if (blob) next.set("view", "blob");
    else next.delete("view");
    if (refName !== null) next.set("ref", refName);
    if (nextPath) next.set("path", nextPath);
    else next.delete("path");
    return `${pathname}${next.size ? `?${next}` : ""}`;
  }

  const parts = path ? path.split("/") : [];
  return (
    <section
      className={isBlob ? styles.fileWorkspace : styles.source}
      aria-label={isBlob ? "Nội dung file" : "Cây thư mục"}
    >
      {isBlob && <FileSidebar key={`${endpoint}/${refName}/${user?.id}`} endpoint={endpoint} refName={refName} selected={path} href={href} />}
      <div className={styles.fileMain}>
      {path && <div className={styles.sourceNav}>
        <nav className={styles.breadcrumb} aria-label="Đường dẫn mã nguồn">
          <Link
            href={href("")}
            scroll={false}
            aria-current={!path ? "page" : undefined}
          >
            Gốc
          </Link>
          {parts.map((part, i) => (
            <span key={i}>
              {" "}
              /{" "}
              {i === parts.length - 1 ? (
                <strong aria-current="page">{part}</strong>
              ) : (
                <Link
                  href={href(parts.slice(0, i + 1).join("/"))}
                  scroll={false}
                >
                  {part}
                </Link>
              )}
            </span>
          ))}
        </nav>
        {path && (
          <Link
            className={styles.parentLink}
            href={href(parts.slice(0, -1).join("/"))}
            scroll={false}
          >
            ← Thư mục cha
          </Link>
        )}
      </div>}
      {result.key !== key ? (
        <p role="status">
          {isBlob ? "Đang tải file…" : "Đang tải cây thư mục…"}
        </p>
      ) : !result.data ? (
        <div className={styles.empty}>
          <p role="alert">{result.error}</p>
          <button
            className="button buttonSecondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {isBlob ? "Tải lại file" : "Tải lại thư mục"}
          </button>
          {path && (
            <Link href={href("")} scroll={false}>
              Về thư mục gốc
            </Link>
          )}
        </div>
      ) : "kind" in result.data ? (
        <><FileCommit key={`${endpoint}/${refName}/${path}/${user?.id}`} endpoint={endpoint} refName={refName} path={path} /><BlobViewer data={result.data} /></>
      ) : (
        <>
          {result.data.storageState === "RESET" && (
            <p className={styles.notice}>
              Git storage đã được khởi tạo lại; mã nguồn trước đó không còn.
            </p>
          )}
          {result.data.entries.length ? (
            <ul className={styles.treeList}>
              {result.data.entries.map((entry) => (
                <li key={entry.path}>
                  <div className={styles.treeItemMain}>
                    <span aria-hidden="true" className={styles.entryIcon}>
                      {entry.type === "directory" ? (
                        <FolderIcon />
                      ) : (
                        <FileIcon tone={fileTone(entry.name)} />
                      )}
                    </span>
                    {entry.navigable &&
                    (entry.type === "directory" || entry.type === "file") ? (
                      <Link
                        href={href(entry.path, entry.type === "file")}
                        scroll={false}
                      >
                        {entry.name}
                        {entry.type === "directory" ? "/" : ""}
                      </Link>
                    ) : (
                      <span>
                        {entry.name}
                        {entry.type === "directory" ? "/" : ""}
                      </span>
                    )}
                  </div>
                  {entry.lastCommit && <><Link className={styles.entryCommit} title={entry.lastCommit.subject} href={`${pathname}?${new URLSearchParams({ ...(refName ? { ref: refName } : {}), view: "commit", sha: entry.lastCommit.sha })}`}>{entry.lastCommit.subject || "(Không có thông điệp)"}</Link><time className={styles.entryTime} dateTime={entry.lastCommit.committedAt} title={new Date(entry.lastCommit.committedAt).toLocaleString("vi-VN")}>{relativeTime(entry.lastCommit.committedAt)}</time></>}
                  {!entry.lastCommit && <small>
                    {labels[entry.type]}
                    {entry.type === "directory" && !entry.navigable
                      ? " · Đường dẫn không được hỗ trợ"
                      : ""}
                  </small>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.treeEmpty}>Thư mục chưa có nội dung.</p>
          )}
          {refName && result.data.storageState === "READY" && (
            <ReadmeViewer
              key={key}
              endpoint={endpoint}
              refName={refName}
              filePath={
                ["readme.md", "readme.markdown", "readme"].flatMap((name) =>
                  result.data && "entries" in result.data
                    ? result.data.entries.filter(
                        (entry) =>
                          entry.type === "file" &&
                          entry.navigable &&
                          entry.name.toLowerCase() === name,
                      )
                    : [],
                )[0]?.path ?? null
              }
            />
          )}
        </>
      )}
      </div>
    </section>
  );
}

function FileSidebar({ endpoint, refName, selected, href }: { endpoint: string; refName: string | null; selected: string; href: (path: string, blob?: boolean) => string }) {
  return <aside className={styles.fileSidebar}><h2>Tệp dự án</h2><DirectoryNodes endpoint={endpoint} refName={refName} path="" selected={selected} href={href} /></aside>;
}
function DirectoryNodes({ endpoint, refName, path, selected, href }: { endpoint: string; refName: string | null; path: string; selected: string; href: (path: string, blob?: boolean) => string }) {
  const [result, setResult] = useState<{ entries?: Entry[]; error?: string }>({});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ path });
    if (refName) params.set("ref", refName);
    sessionFetch(`${endpoint}/tree?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Chưa thể tải thư mục.");
      const data = await response.json() as Tree;
      if (!controller.signal.aborted) setResult({ entries: data.entries });
    }).catch(error => { if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : "Lỗi tải thư mục." }); });
    return () => controller.abort();
  }, [endpoint, refName, path, attempt]);
  if (result.error) return <p role="alert">{result.error} <button onClick={() => retry(value => value + 1)}>Thử lại</button></p>;
  if (!result.entries) return <p role="status">Đang tải…</p>;
  return <ul>{result.entries.map(entry => <li key={entry.path}>{entry.type === "directory" && entry.navigable ? <SidebarDirectory entry={entry} endpoint={endpoint} refName={refName} selected={selected} href={href} /> : <Link href={entry.navigable ? href(entry.path, true) : href(path)} aria-current={entry.path === selected ? "page" : undefined}><FileIcon tone={fileTone(entry.name)} /><span>{entry.name}</span></Link>}</li>)}</ul>;
}
function SidebarDirectory({ entry, endpoint, refName, selected, href }: { entry: Entry; endpoint: string; refName: string | null; selected: string; href: (path: string, blob?: boolean) => string }) {
  const [open, setOpen] = useState(selected.startsWith(`${entry.path}/`));
  return <><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}><span aria-hidden="true">{open ? "⌄" : "›"}</span><FolderIcon /><span>{entry.name}</span></button>{open && <DirectoryNodes endpoint={endpoint} refName={refName} path={entry.path} selected={selected} href={href} />}</>;
}

function FileCommit({ endpoint, refName, path }: { endpoint: string; refName: string | null; path: string }) {
  const pathname = usePathname();
  const [result, setResult] = useState<{ commit?: Entry["lastCommit"]; error?: string }>({});
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ path: path.split("/").slice(0, -1).join("/") });
    if (refName) params.set("ref", refName);
    sessionFetch(`${endpoint}/tree?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Chưa thể tải commit của tệp.");
      const tree = await response.json() as Tree;
      if (!controller.signal.aborted) setResult({ commit: tree.entries.find(entry => entry.path === path)?.lastCommit ?? null });
    }).catch(error => { if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : "Lỗi tải commit." }); });
    return () => controller.abort();
  }, [endpoint, refName, path, attempt]);
  if (result.error) return <p role="alert">{result.error} <button onClick={() => retry(value => value + 1)}>Thử lại</button></p>;
  if (result.commit === undefined) return <p role="status">Đang tải commit của tệp…</p>;
  const commit = result.commit;
  if (!commit) return null;
  return <div className={styles.fileCommit}><strong>{commit.authorName}</strong><Link title={commit.subject} className={styles.fileCommitSubject} href={`${pathname}?${new URLSearchParams({ ...(refName ? { ref: refName } : {}), view: "commit", sha: commit.sha })}`}>{commit.subject}</Link><code>{commit.sha.slice(0, 7)}</code><time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString("vi-VN")}>{relativeTime(commit.committedAt)}</time></div>;
}
