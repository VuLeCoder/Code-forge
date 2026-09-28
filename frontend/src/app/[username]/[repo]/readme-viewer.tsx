"use client";

import Link from "next/link";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import type { BlobData } from "./blob-viewer";
import styles from "./repository.module.css";

// Resolve source paths ourselves: URL normalization would silently permit escaping the repo root.
function sourceTarget(value: string, directory: string) {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith("//")) return null;
  const [rawPath, fragment = ""] = value.split("#", 2);
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath.split("?", 1)[0]); } catch { return null; }
  if (/[\u0000-\u001f\u007f\\:]/.test(decoded) || decoded.startsWith("//")) return null;
  const parts = decoded.startsWith("/") ? [] : directory.split("/").filter(Boolean);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return { path: parts.join("/"), directory: decoded.endsWith("/") || decoded === "." || decoded === "..", fragment };
}

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => typeof child === "string" || typeof child === "number" ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "").join("");
}
function slug(value: string) { return value.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").replace(/\s/g, "-"); }

function ReadmeImage({ src, alt, title, local }: { src: string; alt?: string; title?: string; local: boolean }) {
  const [result, setResult] = useState<{ src: string; url?: string }>({ src: "" });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!local) return;
    let active = true;
    const controller = new AbortController();
    sessionFetch(src, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || body.kind !== "image" || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(body.mime)) throw new Error();
      if (active) setResult({ src, url: `data:${body.mime};base64,${body.content}` });
    }).catch(() => { if (active) setResult({ src }); });
    return () => { active = false; controller.abort(); };
  }, [local, src]);
  if (failed || (local && result.src === src && !result.url)) return <span className={styles.imageNotice}>Không thể hiển thị ảnh: {alt || "Ảnh README"} (ảnh thiếu, quá lớn hoặc định dạng không hỗ trợ).</span>;
  if (local && result.src !== src) return <span>Đang tải ảnh: {alt}</span>;
  // Source images require cookie-aware fetch; external images never use the Next image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={local ? result.url : src} alt={alt ?? ""} title={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function ReadmeViewer({ endpoint, refName, filePath }: { endpoint: string; refName: string; filePath: string | null }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([endpoint, refName, filePath, user?.id, attempt]);
  const [result, setResult] = useState<{ key: string; data?: BlobData; error?: string }>({ key: "" });
  useEffect(() => {
    if (!filePath) return;
    let active = true;
    const controller = new AbortController();
    sessionFetch(`${endpoint}/blob?${new URLSearchParams({ ref: refName, path: filePath })}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.code === "PATH_NOT_FOUND" ? "README không còn tồn tại trên branch này." : response.status === 404 ? "README không khả dụng hoặc bạn không có quyền xem." : "Chưa thể tải README.");
        if (active) setResult({ key, data: body });
      }).catch((error) => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Chưa thể tải README." }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, refName, filePath, key]);

  if (!filePath) return <p className={styles.treeEmpty}>Thư mục này chưa có README.</p>;
  const directory = filePath.split("/").slice(0, -1).join("/");
  const sourceHref = `${pathname}?${new URLSearchParams({ ref: refName, path: filePath, view: "blob" })}`;
  const data = result.key === key ? result.data : undefined;
  const ids = new Map<string, number>();
  function heading(children: ReactNode) {
    const base = slug(textContent(children));
    const count = ids.get(base) ?? 0;
    ids.set(base, count + 1);
    return `readme-${base}${count ? `-${count}` : ""}`;
  }
  function urlTransform(url: string, property: string) {
    if (/[\u0000-\u0020\u007f\\]/.test(url)) return "";
    if (/^https:\/\//i.test(url) || (property === "href" && /^(https?:\/\/|mailto:)/i.test(url))) return url;
    if (property === "href" && url.startsWith("#")) return `#readme-${url.slice(1)}`;
    const target = sourceTarget(url, directory);
    if (!target) return "";
    if (property === "src") return `${endpoint}/image?${new URLSearchParams({ ref: refName, path: target.path })}`;
    const params = new URLSearchParams({ ref: refName });
    if (target.path) params.set("path", target.path);
    if (!target.directory && target.path) params.set("view", "blob");
    return `${pathname}?${params}`;
  }

  return <section className={styles.readmePanel} aria-label="README">
    <div className={styles.blobMeta}><strong>Xem trước {filePath.split("/").at(-1)}</strong><span>Branch: {refName}</span><Link href={sourceHref} scroll={false}>Xem mã nguồn README</Link></div>
    {result.key !== key ? <p role="status">Đang tải README…</p> : !data ? <div><p role="alert">{result.error}</p><button className="button buttonSecondary" onClick={() => setAttempt((n) => n + 1)}>Tải lại README</button></div>
      : data.kind === "large" ? <p>README vượt giới hạn 1 MiB, không thể xem trước.</p>
      : data.kind === "binary" ? <p>README là file nhị phân hoặc không phải UTF-8.</p>
      : !data.content ? <p>README trống.</p>
      : <>
        {data.truncated && <p className={styles.notice} role="status">README đã được cắt ở giới hạn 128 KiB hoặc 2.000 dòng; đây chưa phải toàn bộ nội dung.</p>}
        <div className={styles.markdown}>
          <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={{
            a: ({ href, children, title }) => !href ? <span>{children}</span> : href.startsWith(`${pathname}?`) ? <Link href={href} title={title} scroll={false}>{children}</Link> : <a href={href} title={title} rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>,
            img: ({ src, alt, title }) => typeof src === "string" && src ? <ReadmeImage key={src} src={src} alt={alt} title={title} local={src.startsWith(`${endpoint}/image?`)} /> : <span>Ảnh không được hỗ trợ: {alt}</span>,
            h1: ({ children }) => <h1 id={heading(children)}>{children}</h1>,
            h2: ({ children }) => <h2 id={heading(children)}>{children}</h2>,
            h3: ({ children }) => <h3 id={heading(children)}>{children}</h3>,
            h4: ({ children }) => <h4 id={heading(children)}>{children}</h4>,
            h5: ({ children }) => <h5 id={heading(children)}>{children}</h5>,
            h6: ({ children }) => <h6 id={heading(children)}>{children}</h6>,
          }}>{data.content}</Markdown>
        </div>
      </>}
  </section>;
}
