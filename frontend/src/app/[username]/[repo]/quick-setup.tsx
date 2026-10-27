"use client";

import Link from "next/link";
import { useState } from "react";
import type { RepositorySummary } from "@/lib/repositories";
import styles from "./repository.module.css";

type QuickSetupRepository = RepositorySummary & {
  defaultBranch?: string;
  storageState?: "READY" | "EMPTY" | "RESET";
};

export function QuickSetup({ repository }: { repository: QuickSetupRepository }) {
  const [message, setMessage] = useState("");
  const isPrivate = repository.visibility === "PRIVATE";
  const isEmpty = repository.storageState === "EMPTY" || repository.storageState === "RESET";
  const branch = repository.defaultBranch ?? "main";
  const resolvedUrl = repository.cloneUrl ?? "";
  const cloneTarget = resolvedUrl || "<URL clone>";
  const commands = isEmpty
    ? [
        `git init -b ${branch}`,
        `git remote add origin ${cloneTarget}`,
        "git add .",
        'git commit -m "Initial commit"',
        `git push -u origin ${branch}`,
      ]
    : [`git clone ${cloneTarget}`, `cd ${repository.name}`, "git fetch origin"];

  async function copyCommands() {
    try {
      await navigator.clipboard.writeText(commands.join("\n"));
      setMessage("Đã sao chép hướng dẫn Git.");
    } catch {
      setMessage("Không thể sao chép tự động. Bạn có thể bôi đen các lệnh để sao chép.");
    }
  }

  return <section className={styles.quickSetup} aria-labelledby="quick-setup-title">
    <div className={styles.quickSetupHeader}>
      <div>
        <span className="eyebrow">Quick setup</span>
        <h2 id="quick-setup-title">Bắt đầu với repository này</h2>
        <p>{isEmpty ? "Tạo commit đầu tiên từ máy local rồi push lên Code Forge." : "Clone repository về máy để bắt đầu làm việc như trên GitHub."}</p>
      </div>
      <button className="button buttonSecondary" type="button" onClick={copyCommands} disabled={!resolvedUrl}>Sao chép lệnh</button>
    </div>

    <div className={styles.quickSetupGrid}>
      <div>
        <h3>{isEmpty ? "Đã có thư mục dự án trên máy?" : "Clone bằng HTTPS"}</h3>
        <ol className={styles.quickSetupSteps}>
          {isEmpty ? <>
            <li>Trong thư mục dự án, khởi tạo Git và thêm remote:</li>
            <li>Thêm file, tạo commit đầu tiên, rồi push lên branch <code>{branch}</code>.</li>
          </> : <>
            <li>Clone repository về máy:</li>
            <li>Chuyển vào thư mục và tải commit mới nhất bằng <code>git fetch origin</code>.</li>
          </>}
        </ol>
        <pre className={styles.quickSetupCode}><code>{commands.join("\n")}</code></pre>
      </div>
      <aside className={styles.quickSetupAside}>
        <h3>URL clone</h3>
        <code className={styles.cloneUrl}>{resolvedUrl || "URL clone chưa được cung cấp"}</code>
        {isPrivate ? <p>Repository riêng tư cần username tài khoản và PAT. Khi Git hỏi mật khẩu, nhập PAT có quyền <code>repo:read</code>{repository.permissions.canWrite ? ", repo:write" : ""}; không đưa PAT vào URL.</p> : <p>Repository công khai có thể clone mà không cần đăng nhập.</p>}
        {repository.permissions.canWrite ? <p>Bạn có quyền ghi. Push branch bằng <code>git push origin ten-branch</code>.</p> : <p>Bạn đang có quyền chỉ đọc; cần WRITE hoặc OWNER để push.</p>}
        {isPrivate && <Link href="/settings/tokens">Tạo hoặc quản lý PAT</Link>}
      </aside>
    </div>
    <p className={styles.quickSetupStatus} role="status" aria-live="polite">{message}</p>
  </section>;
}
