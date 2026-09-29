"use client";

import { useRef, useState } from "react";
import type { RepositorySummary } from "@/lib/repositories";
import styles from "./repository.module.css";

export function CloneDialog({ repository }: { repository: RepositorySummary }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const isPublic = repository.visibility === "PUBLIC";
  function open() {
    setUrl(`${window.location.origin}/git/${encodeURIComponent(repository.owner.username)}/${encodeURIComponent(repository.name)}.git`);
    setMessage("");
    dialog.current?.showModal();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMessage("Đã sao chép URL clone."); }
    catch { input.current?.focus(); input.current?.select(); setMessage("Không thể sao chép tự động. Hãy sao chép URL đã chọn."); }
  }
  return <>
    <button ref={trigger} className="button buttonSecondary" onClick={open}>Clone</button>
    <dialog ref={dialog} className={styles.cloneDialog} aria-labelledby="clone-title" onClose={() => trigger.current?.focus()}>
      <h2 id="clone-title">Clone repository</h2>
      {isPublic ? <>
        <p>Sao chép repository về máy qua HTTP(S). Repository công khai không cần đăng nhập.</p>
        <label htmlFor="clone-url">URL clone</label>
        <input ref={input} id="clone-url" readOnly value={url} onFocus={(event) => event.target.select()} />
        <button className="button buttonSecondary" onClick={copy}>Sao chép URL</button>
        <pre><code>git clone {url}</code></pre>
        <p>Trong thư mục đã clone, chạy <code>git fetch origin</code> để tải commit mới. Repository rỗng vẫn có thể clone.</p>
        <p>Git push chưa được hỗ trợ ở giai đoạn này.</p>
      </> : <p>Clone repository riêng tư chưa khả dụng. Tính năng này cần xác thực bằng token truy cập cá nhân (PAT); phiên đăng nhập web hiện chưa dùng để clone qua Git.</p>}
      <p role="status">{message}</p>
      <button className="button buttonSecondary" onClick={() => dialog.current?.close()}>Đóng</button>
    </dialog>
  </>;
}
