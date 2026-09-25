"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { RequireAuth } from "@/components/require-auth";
import { sessionFetch } from "@/lib/auth";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import styles from "./new.module.css";

const namePattern = /^(?!.*\.\.)(?!.*\.git$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

function CreateForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [initializeReadme, setInitializeReadme] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!namePattern.test(name) || name.length > 100) {
      setError("Tên repository phải dài 1–100 ký tự, chỉ gồm chữ cái, số, dấu chấm, gạch dưới hoặc gạch ngang; không có '..' hay đuôi .git.");
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const response = await sessionFetch("/api/v1/repositories", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: description || null, visibility, initializeReadme }),
      });
      const result = await response.json() as { repository?: RepositorySummary; error?: { code?: string; message?: string } };
      if (!response.ok || !result.repository) {
        const messages: Record<string, string> = {
          REPOSITORY_NAME_TAKEN: "Tên repository này đã được sử dụng, kể cả repository đang chờ xóa vĩnh viễn.",
          REPOSITORY_QUOTA_EXCEEDED: "Bạn đã đạt giới hạn số repository.",
          AUTH_REQUIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
          ACCESS_TOKEN_INVALID: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
          BACKEND_UNAVAILABLE: "Máy chủ đang tạm thời gián đoạn. Vui lòng thử lại sau.",
        };
        throw new Error(messages[result.error?.code ?? ""] ?? result.error?.message ?? "Không thể tạo repository. Vui lòng thử lại.");
      }
      router.push(repositoryPath(result.repository));
    } catch (caught) {
      setError(caught instanceof TypeError ? "Không thể kết nối với máy chủ. Vui lòng thử lại." : caught instanceof Error ? caught.message : "Không thể tạo repository. Vui lòng thử lại.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  return <div className={styles.layout}>
    <div className={styles.heading}><span className="eyebrow">Không gian làm việc</span><h1>Tạo repository</h1><p>Lưu trữ dự án mới trong tài khoản của bạn.</p></div>
    <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
      {error && <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      <div className={styles.field}><label htmlFor="repo-name">Tên repository <span aria-hidden="true">*</span></label><div className={styles.nameRow}><span>{user?.username ?? "…"} /</span><input id="repo-name" name="name" required maxLength={100} autoFocus placeholder="du-an-cua-ban" aria-describedby="name-hint" /></div><p id="name-hint">Dùng chữ cái, số, dấu chấm, gạch dưới hoặc gạch ngang. Không dùng “..” hay đuôi .git.</p></div>
      <div className={styles.field}><label htmlFor="repo-description">Mô tả <span className={styles.optional}>(không bắt buộc)</span></label><textarea id="repo-description" name="description" maxLength={2000} rows={3} placeholder="Dự án này dùng để làm gì?" /></div>
      <fieldset className={styles.visibility}><legend>Quyền xem</legend><label><input type="radio" name="visibility" value="PUBLIC" checked={visibility === "PUBLIC"} onChange={() => setVisibility("PUBLIC")} /><span><strong>Công khai</strong><small>Mọi người có thể xem repository.</small></span></label><label><input type="radio" name="visibility" value="PRIVATE" checked={visibility === "PRIVATE"} onChange={() => setVisibility("PRIVATE")} /><span><strong>Riêng tư</strong><small>Chỉ bạn có thể xem repository.</small></span></label></fieldset>
      <div className={styles.visibility}><label><input type="checkbox" name="initializeReadme" checked={initializeReadme} onChange={(event) => setInitializeReadme(event.target.checked)} /><span><strong>Thêm README.md</strong><small>Tạo commit đầu tiên với tên repository.</small></span></label></div>
      <div className={styles.actions}><button className="button buttonPrimary" type="submit" disabled={submitting}>{submitting ? "Đang tạo…" : "Tạo repository"}</button><Link className="button buttonSecondary" href={user ? `/${encodeURIComponent(user.username)}` : "/"}>Hủy</Link></div>
    </form>
  </div>;
}

export default function NewRepositoryPage() {
  return <main className="container"><RequireAuth><CreateForm /></RequireAuth></main>;
}
