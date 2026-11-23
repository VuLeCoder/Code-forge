"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import { RepositoryIcon } from "./repository-icon";
import styles from "./repository.module.css";

export function RepositoryAboutEditor({ endpoint, description, onSaved }: { endpoint: string; description: string | null; onSaved: (description: string | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await sessionFetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: draft.trim() || null }) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Phiên đăng nhập đã hết hạn hoặc bạn không còn quyền sửa mô tả." : "Không thể lưu mô tả. Vui lòng thử lại.");
      const body = await response.json() as { repository: { description: string | null } };
      onSaved(body.repository.description);
      dialog.current?.close();
    } catch (error) { setError(error instanceof Error ? error.message : "Không thể lưu mô tả."); }
    finally { setPending(false); }
  }
  return <>
    <button type="button" className={styles.aboutSettings} aria-label="Chỉnh sửa mô tả" title="Chỉnh sửa mô tả" onClick={() => { setDraft(description ?? ""); setError(""); dialog.current?.showModal(); input.current?.focus(); }}><RepositoryIcon name="settings" /></button>
    <dialog ref={dialog} className={styles.aboutDialog} aria-labelledby="about-dialog-title" onCancel={event => { if (pending) event.preventDefault(); }}>
      <header className={styles.aboutDialogHeader}><h2 id="about-dialog-title">Chỉnh sửa giới thiệu</h2><button type="button" className={styles.aboutSettings} aria-label="Đóng" disabled={pending} onClick={() => dialog.current?.close()}>×</button></header>
      <form onSubmit={save} className={styles.aboutForm} aria-busy={pending}>
        <label htmlFor="about-description">Mô tả</label>
        <textarea ref={input} id="about-description" value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={4} autoFocus disabled={pending} aria-describedby="about-description-count" />
        <small id="about-description-count">Còn {2000 - draft.length} ký tự</small>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" className="button buttonSecondary" disabled={pending} onClick={() => dialog.current?.close()}>Hủy</button><button type="submit" className="button buttonPrimary" disabled={pending}>{pending ? "Đang lưu…" : "Lưu thay đổi"}</button></footer>
      </form>
    </dialog>
  </>;
}

type Entry = { name: string; path: string; type: string; navigable: boolean };
export function ReadmeShortcut({ endpoint }: { endpoint: string }) {
  const query = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const ref = query.get("ref");
  const key = JSON.stringify([endpoint, ref, user?.id]);
  const [result, setResult] = useState<{ key: string; path: string | null }>({ key: "", path: null });
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ path: "" });
    if (ref) params.set("ref", ref);
    sessionFetch(`${endpoint}/tree?${params}`, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) { if (!controller.signal.aborted) setResult({ key, path: null }); return; }
      const body = await response.json() as { entries: Entry[] };
      const path = ["readme.md", "readme.markdown", "readme"].flatMap(name => body.entries.filter(entry => entry.type === "file" && entry.navigable && entry.name.toLowerCase() === name))[0]?.path ?? null;
      if (!controller.signal.aborted) setResult({ key, path });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, path: null }); });
    return () => controller.abort();
  }, [endpoint, ref, key]);
  if (result.key !== key || !result.path) return null;
  const params = new URLSearchParams({ view: "blob", path: result.path });
  if (ref) params.set("ref", ref);
  return <Link href={`${pathname}?${params}`}><RepositoryIcon name="book" />README</Link>;
}
