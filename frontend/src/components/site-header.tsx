"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-provider";

export function SiteHeader() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Local session still returns to the anonymous state; a later bootstrap
      // will reconcile it if the backend could not revoke the cookie.
    } finally {
      setMenuOpen(false);
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
        <div className="userMenu" ref={menuRef}>
          <Link className="userProfileLink" href={`/${encodeURIComponent(user.username)}`} aria-label={`Hồ sơ ${user.username}`}>
            <strong>{user.username}</strong>
          </Link>
          <button
            ref={menuTriggerRef}
            className="userMenuTrigger"
            type="button"
            aria-label={`Mở menu tài khoản ${user.username}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="userAvatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
            <span className="menuChevron" aria-hidden="true">⌄</span>
          </button>
          {menuOpen && <div className="userMenuPanel" role="menu" aria-label="Menu tài khoản">
            <div className="userMenuSummary"><span className="eyebrow">Tài khoản</span><strong>{user.username}</strong><small>{user.email}</small></div>
            <Link className="userMenuItem" role="menuitem" href={`/${encodeURIComponent(user.username)}`} onClick={() => setMenuOpen(false)}>Hồ sơ của tôi</Link>
            <Link className="userMenuItem" role="menuitem" href="/invitations" onClick={() => setMenuOpen(false)}>Lời mời cộng tác</Link>
            <Link className="userMenuItem" role="menuitem" href="/settings/tokens" onClick={() => setMenuOpen(false)}>Personal access token</Link>
            {user.systemRole === "ADMIN" && <Link className="userMenuItem" role="menuitem" href="/admin" onClick={() => setMenuOpen(false)}>Khu vực quản trị</Link>}
          </div>}
        </div>
        <button className="textButton" type="button" onClick={handleLogout} disabled={loggingOut}>{loggingOut ? "Đang thoát…" : "Đăng xuất"}</button>
      </> : <>
        <Link className="textLink" href="/login">Đăng nhập</Link><Link className="button buttonPrimary buttonSmall" href="/register">Đăng ký</Link>
      </>}
    </div>
  </div></header>;
}
