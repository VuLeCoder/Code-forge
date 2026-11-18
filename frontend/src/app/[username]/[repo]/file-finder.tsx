"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import { RepositoryIcon } from "./repository-icon";
import styles from "./repository.module.css";
export function FileFinder({ endpoint, refName }: { endpoint: string; refName: string | null }) {
  const pathname = usePathname(); const { user } = useAuth(); const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""); const [open, setOpen] = useState(false); const [selected, setSelected] = useState(0);
  const key = JSON.stringify([endpoint, refName, query, user?.id]);
  const [result, setResult] = useState<{ key: string; files?: string[]; hasMore?: boolean; error?: string }>({ key: "" });
  useEffect(() => { const listener = (event: KeyboardEvent) => {
    if (event.key === "t" && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof HTMLElement && (event.target.closest("input,textarea,select,[contenteditable=true]") || event.target.isContentEditable))) { event.preventDefault(); input.current?.focus(); setOpen(true); }
  }; document.addEventListener("keydown", listener); return () => document.removeEventListener("keydown", listener); }, []);
  useEffect(() => { if (!open || !refName) return; let active = true; const controller = new AbortController();
    const timer = setTimeout(() => { sessionFetch(`${endpoint}/files?${new URLSearchParams({ ref: refName, q: query })}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Chưa thể tìm file. Hãy thử lại hoặc nhập từ khóa cụ thể hơn.");
      const data = await response.json() as { files: string[]; hasMore: boolean }; if (active) setResult({ key, ...data });
    }).catch(error => { if (active) setResult({ key, error: error instanceof Error ? error.message : "Không thể tìm file." }); }); }, 200);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [endpoint, refName, query, open, key]);
  const files = result.key === key ? result.files ?? [] : [];
  return <div className={styles.fileFinder} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <RepositoryIcon name="search" className={styles.finderIcon} />
    <kbd className={styles.finderShortcut} aria-hidden="true">T</kbd>
    <input ref={input} role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={open && files.length ? `file-result-${selected}` : undefined} aria-label="Tìm file" placeholder="Tìm file…" disabled={!refName} value={query} aria-expanded={open} aria-controls="file-results" onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setSelected(0); setOpen(true); }} onKeyDown={event => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowDown") { event.preventDefault(); setSelected(value => Math.min(value + 1, Math.max(0, files.length - 1))); }
      if (event.key === "ArrowUp") { event.preventDefault(); setSelected(value => Math.max(0, value - 1)); }
      if (event.key === "Enter") document.getElementById(`file-result-${selected}`)?.click();
    }} />
    {open && refName && <div id="file-results" role="listbox" aria-label="Kết quả tìm file" className={styles.fileResults}>
      {result.key !== key ? <p role="status">Đang tìm file…</p> : result.error ? <p role="alert">{result.error}</p> : <>
        {!files.length && <p>Không tìm thấy file.</p>}
        {files.map((file, index) => <Link role="option" aria-selected={index === selected} id={`file-result-${index}`} key={file} aria-current={index === selected ? "true" : undefined} href={`${pathname}?${new URLSearchParams({ ref: refName, path: file, view: "blob" })}`} onClick={() => setOpen(false)}>{file}</Link>)}
        {result.hasMore && <p>Còn kết quả khác. Hãy nhập đường dẫn cụ thể hơn.</p>}
      </>}
    </div>}
  </div>;
}
