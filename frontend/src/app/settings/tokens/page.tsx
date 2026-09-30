"use client";

import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { useAuth } from "@/components/auth-provider";
import { sessionFetch } from "@/lib/auth";
import styles from "./tokens.module.css";

type Token = { id: string; name: string; tokenPrefix: string; scopes: string[]; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null };
async function api<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api/v1/tokens${path}`, { ...init, cache: "no-store", headers: { "content-type": "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message ?? "Không thể thực hiện yêu cầu. Vui lòng thử lại.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

function TokenManager() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("30");
  const [write, setWrite] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const secretInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    let cancelled = false;
    api<{ tokens: Token[] }>().then((result) => { if (!cancelled) setTokens(result.tokens); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; clearInterval(timer); };
  }, []);
  useEffect(() => { if (secret) secretInput.current?.focus(); }, [secret]);
  async function reload() {
    setLoading(true); setError("");
    try { const result = await api<{ tokens: Token[] }>(); if (alive.current) setTokens(result.tokens); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Không thể tải token."); }
    finally { if (alive.current) setLoading(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ token: Token; secret: string }>("", { method: "POST", body: JSON.stringify({ name: name.trim(), scopes: write ? ["repo:read", "repo:write"] : ["repo:read"], expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString() }) });
      if (!alive.current) return;
      setTokens((previous) => [result.token, ...previous]); setSecret(result.secret); setName("");
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Không thể tạo token."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function revoke() {
    if (!revoking) return;
    setBusy(true); setError("");
    try {
      await api(`/${revoking.id}`, { method: "DELETE" });
      if (!alive.current) return;
      setTokens((previous) => previous.map((token) => token.id === revoking.id ? { ...token, revokedAt: new Date().toISOString() } : token));
      setSecret(""); setMessage("Đã thu hồi token."); confirmation.current?.close(); setRevoking(null);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Không thể thu hồi token."); }
    finally { if (alive.current) setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(secret); setMessage("Đã sao chép token."); }
    catch { secretInput.current?.focus(); secretInput.current?.select(); setMessage("Hãy sao chép token đã chọn."); }
  }
  return <div className={styles.manager}>
    <h1>Token truy cập cá nhân</h1>
    <p>Dùng username và PAT khi Git hỏi mật khẩu. Token chỉ có hiệu lực với repository bạn được phép truy cập. Không đặt token trong URL clone.</p>
    {error && <p role="alert">{error}</p>}
    <p role="status">{message}</p>
    {secret && <section className={styles.secret} aria-label="Token mới">
      <h2>Lưu token ngay</h2><p>Secret chỉ hiển thị lần này. Sau khi đóng hoặc rời trang, bạn không thể xem lại.</p>
      <label htmlFor="token-secret">Secret PAT</label><input ref={secretInput} id="token-secret" value={secret} readOnly onFocus={(event) => event.target.select()} />
      <div className={styles.actions}><button className="button buttonSecondary" onClick={copy}>Sao chép token</button><button className="button buttonSecondary" onClick={() => { setSecret(""); setMessage(""); }}>Đã lưu, đóng secret</button></div>
    </section>}
    <form onSubmit={create} className={styles.form}>
      <h2>Tạo token</h2>
      <label htmlFor="token-name">Tên token</label><input id="token-name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      <label htmlFor="token-days">Thời hạn</label><select id="token-days" value={days} onChange={(event) => setDays(event.target.value)}><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option><option value="365">365 ngày</option></select>
      <p>Quyền đọc: <code>repo:read</code> (clone/fetch).</p>
      <label><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} /> Thêm quyền <code>repo:write</code></label>
      <p>Git push hiện chưa được hỗ trợ.</p>
      <button className="button buttonPrimary" disabled={busy || !!secret || !name.trim()}>{busy ? "Đang xử lý…" : "Tạo token"}</button>
    </form>
    <section><h2>Token của bạn</h2>
      {loading ? <p role="status">Đang tải token…</p> : <>
        <button className="button buttonSecondary" onClick={reload} disabled={busy}>Tải lại danh sách</button>
        {!tokens.length && !error && <p>Chưa có token nào.</p>}
        <ul className={styles.list}>{tokens.map((token) => <li key={token.id}>
          <h3>{token.name}</h3><p>Prefix: <code>{token.tokenPrefix}</code> · {token.scopes.join(", ")}</p>
          <p>{token.revokedAt ? "Đã thu hồi" : new Date(token.expiresAt).getTime() <= now ? "Đã hết hạn" : "Đang hoạt động"} · Hết hạn: {new Date(token.expiresAt).toLocaleString("vi-VN")}</p>
          <p>Lần dùng gần nhất: {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString("vi-VN") : "Chưa dùng"}</p>
          {!token.revokedAt && <button className="button buttonSecondary" disabled={busy} onClick={() => { setRevoking(token); confirmation.current?.showModal(); }}>Thu hồi {token.name}</button>}
        </li>)}</ul>
      </>}
    </section>
    <dialog ref={confirmation} className={styles.dialog} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <h2>Thu hồi token {revoking?.name}?</h2><p>Các yêu cầu Git tiếp theo dùng token này sẽ bị từ chối.</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}><button className="button buttonPrimary" disabled={busy} onClick={revoke}>Xác nhận thu hồi</button><button className="button buttonSecondary" disabled={busy} onClick={() => confirmation.current?.close()}>Hủy</button></div>
    </dialog>
  </div>;
}
export default function TokensPage() {
  const { user } = useAuth();
  return <main className="container"><RequireAuth><TokenManager key={user?.id} /></RequireAuth></main>;
}
