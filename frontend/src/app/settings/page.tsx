"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { RequireAuth } from "@/components/require-auth";
import { Avatar } from "@/components/avatar";
import { sessionFetch, type AuthUser } from "@/lib/auth";
import styles from "./settings.module.css";
import { TokenManager } from "./tokens/token-manager";

const tabs = [{ id: "profile", label: "Hồ sơ và email" }, { id: "password", label: "Mật khẩu" }, { id: "tokens", label: "PAT" }];
function TabIcon({ kind }: { kind: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{kind === "profile" ? <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></> : kind === "password" ? <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></> : <><circle cx="8" cy="9" r="5" /><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3" /></>}</svg>;
}
function subscribeTab(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function readTab() { return window.location.hash.slice(1); }

async function prepareAvatar(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Chọn ảnh JPG, PNG hoặc WebP tối đa 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không thể xử lý ảnh.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 256, 256);
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const result = canvas.toDataURL("image/jpeg", .8);
    if (result.length > 64000) throw new Error("Ảnh quá phức tạp. Vui lòng chọn ảnh khác.");
    return result;
  } finally { bitmap.close(); }
}

function AccountSettings() {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const hash = useSyncExternalStore(subscribeTab, readTab, () => "profile");
  const tab = tabs.some(item => item.id === hash) ? hash : "profile";
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;

  async function save(event: FormEvent<HTMLFormElement>, kind: "profile" | "password" | "avatar") {
    event.preventDefault();
    if (!user || busy || processing) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = kind === "avatar" ? { avatarUrl: avatar ?? user.avatarUrl ?? "" } : kind === "profile" ? {
      username: String(data.get("username")).trim(), email: String(data.get("email")).trim(), currentPassword: String(data.get("currentPassword")),
    } : { currentPassword: String(data.get("currentPassword")), newPassword: String(data.get("newPassword")) };
    setError(""); setMessage("");
    if (kind === "password" && data.get("newPassword") !== data.get("confirmation")) { setError("Mật khẩu xác nhận chưa khớp."); return; }
    setBusy(true);
    try {
      const response = await sessionFetch("/api/v1/auth/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json() as { user?: AuthUser; error?: { message?: string }; message?: string | string[] };
      if (!response.ok || !body.user) throw new Error(body.error?.message ?? (Array.isArray(body.message) ? body.message[0] : body.message) ?? "Không thể cập nhật tài khoản.");
      setUser(body.user);
      if (kind === "avatar") setAvatar(undefined);
      form.reset();
      setMessage(kind === "password" ? "Đã đổi mật khẩu. Các phiên khác và personal access token đã được thu hồi." : "Đã lưu thay đổi.");
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Không thể cập nhật tài khoản."); }
    finally { setBusy(false); }
  }

  return <>
    <h1>Cài đặt cá nhân</h1>
    <div className={styles.layout}>
      <nav className={styles.sidebar} role="tablist" aria-label="Cài đặt tài khoản" aria-orientation="vertical" onKeyDown={(event) => {
        const index = tabs.findIndex(item => item.id === tab);
        const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        document.getElementById(`settings-tab-${tabs[next]!.id}`)?.click();
        document.getElementById(`settings-tab-${tabs[next]!.id}`)?.focus();
      }}>{tabs.map(item => <a key={item.id} id={`settings-tab-${item.id}`} href={`#${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => { setError(""); setMessage(""); }}><TabIcon kind={item.id} />{item.label}</a>)}</nav>
      <div className={styles.content}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {message && <p className={styles.message} role="status">{message}</p>}
        <div id="settings-panel-profile" role="tabpanel" aria-labelledby="settings-tab-profile" hidden={tab !== "profile"}>
        <div className={styles.panelGrid}>
        <section id="profile" className={styles.section}><h2>Hồ sơ và email</h2>
          <form key={user.username + user.email} onSubmit={(event) => void save(event, "profile")}>
            <label htmlFor="account-name">Tên tài khoản</label><input id="account-name" name="username" defaultValue={user.username} minLength={3} maxLength={39} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]" autoComplete="username" required />
            <p>Đổi tên tài khoản sẽ đổi đường dẫn hồ sơ và URL các repository. Hãy cập nhật Git remote sau khi đổi tên.</p>
            <label htmlFor="account-email">Email</label><input id="account-email" name="email" type="email" defaultValue={user.email} maxLength={320} autoComplete="email" required />
            <label htmlFor="profile-password">Mật khẩu hiện tại</label><input id="profile-password" name="currentPassword" type="password" maxLength={128} autoComplete="current-password" required />
            <button className="button buttonPrimary" disabled={busy}>Lưu hồ sơ</button>
          </form>
        </section>
        <section id="avatar" className={styles.section}><h2>Ảnh đại diện</h2>
          <form onSubmit={(event) => void save(event, "avatar")}>
            <Avatar className={styles.avatar} username={user.username} avatarUrl={avatar ?? user.avatarUrl} />
            <label htmlFor="avatar-file">Chọn ảnh đại diện</label><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || processing} onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError(""); setMessage(""); setProcessing(true);
              try { setAvatar(await prepareAvatar(file)); }
              catch (failure) { setError(failure instanceof Error ? failure.message : "Không thể đọc ảnh."); }
              finally { setProcessing(false); }
            }} />
            <p>JPG, PNG hoặc WebP, tối đa 5 MB. Ảnh được cắt vuông và thu nhỏ trước khi lưu.</p>
            <div className={styles.actions}><button className="button buttonPrimary" disabled={busy || processing || avatar === undefined}>{processing ? "Đang xử lý ảnh…" : "Lưu ảnh đại diện"}</button><button className="button buttonSecondary" type="button" disabled={busy || processing || !(avatar ?? user.avatarUrl)} onClick={() => setAvatar("")}>Xóa ảnh</button></div>
          </form>
        </section>
        </div>
        </div>
        <div id="settings-panel-password" role="tabpanel" aria-labelledby="settings-tab-password" hidden={tab !== "password"}>
        <div className={styles.panelGrid}>
        <section id="password" className={styles.section}><h2>Đổi mật khẩu</h2>
          <form onSubmit={(event) => void save(event, "password")}>
            <label htmlFor="old-password">Mật khẩu hiện tại</label><input id="old-password" name="currentPassword" type="password" maxLength={128} autoComplete="current-password" required />
            <label htmlFor="new-password">Mật khẩu mới</label><input id="new-password" name="newPassword" type="password" minLength={8} maxLength={128} pattern="(?=.*[A-Za-z])(?=.*[0-9]).*" autoComplete="new-password" required />
            <p>Từ 8–128 ký tự, có ít nhất một chữ cái và một chữ số. Đổi mật khẩu sẽ đăng xuất các phiên khác và thu hồi personal access token.</p>
            <label htmlFor="confirm-password">Xác nhận mật khẩu mới</label><input id="confirm-password" name="confirmation" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
            <button className="button buttonPrimary" disabled={busy}>Đổi mật khẩu</button>
          </form>
        </section>
        <aside className={styles.security}><span className={styles.securityIcon}><TabIcon kind="password" /></span><h2>Bảo mật tài khoản</h2><p>Một mật khẩu riêng cho Code Forge giúp bảo vệ mã nguồn và quyền truy cập dự án của bạn.</p><h3>Mật khẩu mới cần có</h3><ul><li>Từ 8 đến 128 ký tự</li><li>Ít nhất một chữ cái và một chữ số</li></ul><h3>Sau khi đổi mật khẩu</h3><p>Các phiên đăng nhập khác sẽ được đăng xuất và tất cả PAT sẽ được thu hồi. Phiên hiện tại vẫn được giữ.</p></aside>
        </div>
        </div>
        {tab === "tokens" && <div id="settings-panel-tokens" role="tabpanel" aria-labelledby="settings-tab-tokens"><TokenManager key={user.id} /></div>}
      </div>
    </div>
  </>;
}

export default function SettingsPage() {
  return <main className={`container ${styles.page}`}><RequireAuth><AccountSettings /></RequireAuth></main>;
}
