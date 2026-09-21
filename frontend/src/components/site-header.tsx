"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./auth-provider";

export function SiteHeader() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Local session still returns to the anonymous state; a later bootstrap
      // will reconcile it if the backend could not revoke the cookie.
    } finally {
      router.push("/");
      router.refresh();
      setLoggingOut(false);
    }
  }

  return <header className="siteHeader"><div className="headerInner">
    <Link className="brand" href="/" aria-label="Code Forge - Trang chủ"><span className="brandMark" aria-hidden="true">CF</span><span>Code Forge</span></Link>
    <nav className="mainNav" aria-label="Điều hướng chính"><Link href="/#repositories">Khám phá</Link><Link href="/new">Tạo repository</Link></nav>
    <div className="headerActions" aria-busy={loading}>
      {loading ? <span className="sessionSkeleton" aria-label="Đang kiểm tra phiên" /> : user ? <>
        <Link className="userBadge" href={`/${encodeURIComponent(user.username)}`} aria-label={`Hồ sơ ${user.username}`}><span aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span><strong>{user.username}</strong></Link>
        <button className="textButton" type="button" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? "Đang thoát…" : "Đăng xuất"}</button>
      </> : <>
        <Link className="textLink" href="/login">Đăng nhập</Link><Link className="button buttonPrimary buttonSmall" href="/register">Đăng ký</Link>
      </>}
    </div>
  </div></header>;
}
