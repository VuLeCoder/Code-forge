"use client";

import { Select } from "@/components/select";


import { useEffect, useRef, useState } from "react";
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

export function TokenManager() {
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [creating, setCreating] = useState(false);
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
  const creation = useRef<HTMLDialogElement>(null);
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
      creation.current?.close(); setTokens((previous) => [result.token, ...previous]); setSecret(result.secret); setTab("active"); setName("");
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
  const isActive = (token: Token) => !token.revokedAt && new Date(token.expiresAt).getTime() > now;
  const activeCount = tokens.filter(isActive).length;
  const visibleTokens = tokens.filter(token => tab === "active" ? isActive(token) : !isActive(token));
  return <div className={styles.manager}>
    <header className={styles.intro}>
      <div className={styles.introTitle}><span className={styles.keyIcon} aria-hidden="true">⌘</span><div><span className={styles.eyebrow}>TRUY CẬP GIT</span><h2>Token truy cập cá nhân</h2><p>Chìa khóa riêng cho từng thiết bị và công cụ của bạn.</p></div></div>
      <div className={styles.guide}><h3>Kết nối Git bằng PAT</h3><div className={styles.credentials}><div><span>Username</span><strong>Tên tài khoản của bạn</strong></div><div><span>Password</span><strong>Token truy cập cá nhân</strong></div></div><p>Dùng khi clone, fetch hoặc push. Token chỉ có hiệu lực với repo bạn được phép truy cập; giữ riêng tư và không đặt trong URL clone.</p></div>
    </header>

    {error && !creating && <p role="alert">{error}</p>}
    <p role="status" className={styles.feedback}>{message}</p>
    {secret && <section className={styles.secret} aria-label="Token mới">
      <h2>Lưu token ngay</h2><p>Secret chỉ hiển thị lần này. Sau khi đóng hoặc rời trang, bạn không thể xem lại.</p>
      <label htmlFor="token-secret">Secret PAT</label><input ref={secretInput} id="token-secret" value={secret} readOnly onFocus={(event) => event.target.select()} />
      <div className={styles.actions}><button className="button buttonSecondary" onClick={copy}>Sao chép token</button><button className="button buttonSecondary" onClick={() => { setSecret(""); setMessage(""); }}>Đã lưu, đóng secret</button></div>
    </section>}
    <section className={styles.inventory}><div className={styles.listHeading}><h2>Token của bạn</h2><div className={styles.actions}><button className="button buttonPrimary" disabled={busy || !!secret} onClick={() => { setError(""); setCreating(true); creation.current?.showModal(); }}>Tạo token</button></div></div>
      <div className={styles.filterBar}><div className={styles.tabs} role="tablist" aria-label="Trạng thái token">{(["active", "inactive"] as const).map(value => <button key={value} id={`tokens-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls="tokens-panel" tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "active" : event.key === "End" ? "inactive" : tab === "active" ? "inactive" : "active"; setTab(next); document.getElementById(`tokens-${next}-tab`)?.focus(); } }}>{value === "active" ? "Đang hoạt động" : "Đã thu hồi / hết hạn"}<span>{value === "active" ? activeCount : tokens.length - activeCount}</span></button>)}</div><button className={styles.refresh} onClick={reload} disabled={busy || loading}>Tải lại danh sách</button></div>
      <div id="tokens-panel" role="tabpanel" aria-labelledby={`tokens-${tab}-tab`}>
      {loading ? <p role="status">Đang tải token…</p> : <>
        {!visibleTokens.length && !error && <div className={styles.empty}><span aria-hidden="true">⌘</span><h3>{!tokens.length ? "Chưa có token nào." : tab === "active" ? "Chưa có token đang hoạt động." : "Chưa có token đã thu hồi hoặc hết hạn."}</h3><p>{tab === "active" ? "Tạo token để kết nối Git từ máy tính của bạn." : "Các token không còn hiệu lực sẽ xuất hiện tại đây."}</p></div>}
        <ul className={styles.list}>{visibleTokens.map((token) => {
          const expired = new Date(token.expiresAt).getTime() <= now;
          const stateClass = token.revokedAt ? styles.tokenRevoked : expired ? styles.tokenExpired : styles.tokenActive;
          const stateLabel = token.revokedAt ? "Đã thu hồi" : expired ? "Đã hết hạn" : "Đang hoạt động";
          return <li key={token.id}>
          <div className={styles.cardHeading}><span className={styles.cardIcon} aria-hidden="true">⌘</span><h3>{token.name}</h3><span className={`${styles.tokenState} ${stateClass}`}>{stateLabel}</span></div>
          <p className={styles.prefix}>Prefix <code>{token.tokenPrefix}</code></p>
          <div className={styles.scopes}>{token.scopes.map(scope => <span key={scope}>{scope === "repo:write" ? "Đọc & ghi · push" : "Đọc · clone / fetch"}</span>)}</div>
          <dl className={styles.metadata}><div><dt>Hết hạn</dt><dd>{new Date(token.expiresAt).toLocaleString("vi-VN")}</dd></div><div><dt>Lần dùng gần nhất</dt><dd>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString("vi-VN") : "Chưa dùng"}</dd></div></dl>
          <div className={styles.cardFooter}>{!token.revokedAt ? <button className="button buttonSecondary" disabled={busy} onClick={() => { setRevoking(token); confirmation.current?.showModal(); }}>Thu hồi {token.name}</button> : <span>Đã ngừng quyền truy cập Git</span>}</div>
        </li>})}</ul>
      </>}
      </div>
    </section>
    <dialog ref={creation} className={styles.dialog} aria-labelledby="create-token-title" aria-busy={busy} onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={() => { setCreating(false); setName(""); setWrite(false); setDays("30"); setError(""); }}>
    <form onSubmit={create} className={styles.form}>
      <h2 id="create-token-title">Tạo token</h2><p>Đặt tên theo thiết bị hoặc công cụ để dễ quản lý.</p>
      {error && <p role="alert">{error}</p>}
      <label htmlFor="token-name">Tên token</label><input id="token-name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} />
      <label htmlFor="token-days">Thời hạn</label><Select id="token-days" value={days} onChange={(event) => setDays(event.target.value)}><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option><option value="365">365 ngày</option></Select>
      <p>Quyền đọc: <code>repo:read</code> (clone/fetch).</p>
      <label><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} /> Thêm quyền <code>repo:write</code></label>
      <p><code>repo:write</code> cho phép push khi tài khoản có quyền WRITE hoặc OWNER; giao diện sẽ tự kèm <code>repo:read</code> để clone/fetch.</p>
      <div className={styles.actions}><button className="button buttonSecondary" type="button" disabled={busy} onClick={() => creation.current?.close()}>Hủy</button><button className="button buttonPrimary" disabled={busy || !!secret || !name.trim()}>{busy ? "Đang xử lý…" : "Tạo token"}</button></div>
    </form>
    </dialog>
    <dialog ref={confirmation} className={styles.dialog} aria-labelledby="revoke-token-title" aria-describedby="revoke-token-description" aria-busy={busy} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <h2 id="revoke-token-title">Thu hồi token {revoking?.name}?</h2><p id="revoke-token-description">Các yêu cầu Git tiếp theo dùng token này sẽ bị từ chối.</p>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}><button className="button buttonPrimary" disabled={busy} onClick={revoke}>{busy ? "Đang thu hồi…" : "Xác nhận thu hồi"}</button><button className="button buttonSecondary" disabled={busy} onClick={() => confirmation.current?.close()}>Hủy</button></div>
    </dialog>
  </div>;
}
