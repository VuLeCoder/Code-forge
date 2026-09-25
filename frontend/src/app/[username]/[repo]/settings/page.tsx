"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import styles from "./settings.module.css";

const namePattern = /^(?!.*\.\.)(?!.*\.git$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;
type Repository = RepositorySummary & { status: string };
type ApiBody = { repository?: Repository; error?: { code?: string; message?: string } };

function errorMessage(body: ApiBody, fallback: string) {
  const messages: Record<string, string> = {
    REPOSITORY_NAME_TAKEN: "Tên repository này đã được sử dụng, kể cả repository đang chờ xóa vĩnh viễn.",
    AUTH_REQUIRED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    ACCESS_TOKEN_INVALID: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    REPOSITORY_NOT_FOUND: "Repository không còn khả dụng hoặc bạn không có quyền quản lý.",
    BACKEND_UNAVAILABLE: "Máy chủ đang tạm thời gián đoạn. Vui lòng thử lại sau.",
  };
  return messages[body.error?.code ?? ""] ?? body.error?.message ?? fallback;
}

async function readBody(response: Response): Promise<ApiBody> {
  try { return await response.json() as ApiBody; } catch { return {}; }
}

export default function RepositorySettingsPage() {
  const params = useParams<{ username: string; repo: string }>();
  const router = useRouter();
  const { loading } = useAuth();
  const path = `/api/v1/repos/${encodeURIComponent(params.username)}/${encodeURIComponent(params.repo)}`;
  const routeKey = `${params.username}/${params.repo}`;
  const [result, setResult] = useState<{ key: string; repository: Repository | null; error: "not-found" | "unavailable" | null }>({ key: "", repository: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [desiredVisibility, setDesiredVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [confirmation, setConfirmation] = useState("");
  const visibilityDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (loading) return;
    let active = true;
    sessionFetch(path, { cache: "no-store" }).then(async (response) => {
      if (response.status === 404) return { key: routeKey, repository: null, error: "not-found" as const };
      if (!response.ok) throw new Error("Không thể tải cài đặt.");
      const body = await readBody(response);
      return { key: routeKey, repository: body.repository ?? null, error: null };
    }).then((next) => { if (active) setResult(next); })
      .catch(() => { if (active) setResult({ key: routeKey, repository: null, error: "unavailable" }); });
    return () => { active = false; };
  }, [loading, path, routeKey, attempt]);

  const repo = result.key === routeKey ? result.repository : null;
  const canManage = repo?.permissions?.canManage === true;

  async function update(data: Record<string, unknown>, fallback: string) {
    const response = await sessionFetch(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const body = await readBody(response);
    if (!response.ok || !body.repository) throw new Error(errorMessage(body, fallback));
    return body.repository;
  }

  async function saveInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repo || pending) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!namePattern.test(name) || name.length > 100) {
      setFailure("Tên repository phải dài 1–100 ký tự, chỉ gồm chữ cái, số, dấu chấm, gạch dưới hoặc gạch ngang; không có '..' hay đuôi .git.");
      return;
    }
    if (description.length > 2000) { setFailure("Mô tả không được vượt quá 2000 ký tự."); return; }
    setPending(true); setFailure(""); setMessage("");
    try {
      const updated = await update({ name, description: description || null }, "Không thể lưu thông tin repository.");
      if (updated.name !== repo.name) router.replace(`${repositoryPath(updated)}/settings`);
      else setResult({ key: routeKey, repository: updated, error: null });
      setMessage("Đã lưu thông tin repository.");
    } catch (error) { setFailure(error instanceof Error ? error.message : "Không thể lưu thông tin repository."); }
    finally { setPending(false); }
  }

  async function changeVisibility() {
    if (!repo || pending) return;
    setPending(true); setFailure(""); setMessage("");
    try {
      const updated = await update({ visibility: desiredVisibility }, "Không thể đổi quyền xem repository.");
      setResult({ key: routeKey, repository: updated, error: null });
      visibilityDialog.current?.close();
      setMessage(updated.visibility === "PRIVATE" ? "Repository hiện chỉ owner có thể xem." : "Repository hiện được công khai.");
    } catch (error) { setFailure(error instanceof Error ? error.message : "Không thể đổi quyền xem repository."); visibilityDialog.current?.close(); }
    finally { setPending(false); }
  }

  async function remove() {
    if (!repo || pending || confirmation !== repo.name) return;
    setPending(true); setFailure("");
    try {
      const response = await sessionFetch(path, { method: "DELETE" });
      if (!response.ok) throw new Error(errorMessage(await readBody(response), "Không thể xóa repository."));
      deleteDialog.current?.close();
      router.replace(`/${encodeURIComponent(repo.owner.username)}?deleted=1`);
    } catch (error) { setFailure(error instanceof Error ? error.message : "Không thể xóa repository."); deleteDialog.current?.close(); setPending(false); }
  }

  if (loading || result.key !== routeKey) return <main className={`container ${styles.page}`}><p role="status">Đang tải cài đặt…</p></main>;
  if (result.error === "not-found" || (repo && !canManage)) return <main className={`container ${styles.page}`}><h1>Không thể mở cài đặt</h1><p>Repository không tồn tại hoặc bạn không có quyền quản lý.</p><Link href="/">Khám phá repository</Link></main>;
  if (result.error || !repo) return <main className={`container ${styles.page}`}><h1>Chưa thể tải cài đặt</h1><p>Vui lòng thử lại sau.</p><button className="button buttonSecondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></main>;

  return <main className={`container ${styles.page}`}>
    <Link className={styles.back} href={repositoryPath(repo)}>← Về repository</Link>
    <h1>Cài đặt {repo.name}</h1>
    <p className={styles.intro}>Quản lý thông tin và quyền xem của repository.</p>
    {failure && <div className={styles.error} role="alert">{failure}</div>}
    {message && <div className={styles.success} role="status">{message}</div>}
    <section className={styles.card} aria-labelledby="info-title">
      <h2 id="info-title">Thông tin chung</h2>
      <form key={repo.id + repo.name + repo.description} onSubmit={saveInfo} className={styles.form} aria-busy={pending}>
        <label htmlFor="settings-name">Tên repository</label>
        <input id="settings-name" name="name" defaultValue={repo.name} required maxLength={100} />
        <p className={styles.hint}>Đổi tên sẽ thay đổi đường dẫn repository.</p>
        <label htmlFor="settings-description">Mô tả</label>
        <textarea id="settings-description" name="description" defaultValue={repo.description ?? ""} maxLength={2000} rows={3} />
        <button className="button buttonPrimary" type="submit" disabled={pending}>{pending ? "Đang lưu…" : "Lưu thay đổi"}</button>
      </form>
    </section>
    <section className={styles.card} aria-labelledby="visibility-title">
      <h2 id="visibility-title">Quyền xem</h2>
      <p>Hiện tại: <strong>{repo.visibility === "PUBLIC" ? "Công khai" : "Riêng tư"}</strong></p>
      <p>{repo.visibility === "PUBLIC" ? "Mọi người có thể xem repository." : "Chỉ bạn có thể xem repository."}</p>
      <button className="button buttonSecondary" type="button" disabled={pending} onClick={() => { setDesiredVisibility(repo.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC"); visibilityDialog.current?.showModal(); }}>Đổi quyền xem</button>
    </section>
    <section className={`${styles.card} ${styles.danger}`} aria-labelledby="delete-title">
      <h2 id="delete-title">Xóa repository</h2>
      <p>Repository sẽ biến mất khỏi trang công khai và không thể truy cập. Bạn có thể khôi phục trong thời hạn lưu giữ.</p>
      <button className="button buttonSecondary" type="button" disabled={pending} onClick={() => { setConfirmation(""); deleteDialog.current?.showModal(); }}>Xóa repository</button>
    </section>
    <dialog ref={visibilityDialog} className={styles.dialog} aria-labelledby="visibility-confirm-title" onClose={() => setDesiredVisibility(repo.visibility)}>
      <h2 id="visibility-confirm-title">Xác nhận đổi quyền xem</h2>
      <p>{desiredVisibility === "PRIVATE" ? "Sau khi chuyển sang riêng tư, người khác sẽ không thể xem repository này." : "Sau khi chuyển sang công khai, mọi người có thể xem repository này."}</p>
      <div className={styles.actions}><button className="button buttonSecondary" type="button" disabled={pending} onClick={() => visibilityDialog.current?.close()}>Hủy</button><button className="button buttonPrimary" type="button" disabled={pending} onClick={changeVisibility}>Xác nhận đổi quyền xem</button></div>
    </dialog>
    <dialog ref={deleteDialog} className={styles.dialog} aria-labelledby="delete-confirm-title" onClose={() => setConfirmation("")}>
      <h2 id="delete-confirm-title">Xác nhận xóa repository</h2>
      <p>Nhập chính xác <strong>{repo.name}</strong> để xác nhận xóa.</p>
      <label htmlFor="confirm-repo-name">Tên repository</label>
      <input id="confirm-repo-name" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
      <div className={styles.actions}><button className="button buttonSecondary" type="button" disabled={pending} onClick={() => deleteDialog.current?.close()}>Hủy</button><button className={styles.deleteButton} type="button" disabled={pending || confirmation !== repo.name} onClick={remove}>Xác nhận xóa</button></div>
    </dialog>
  </main>;
}
