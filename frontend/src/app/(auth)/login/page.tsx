"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authApi, authErrorMessage, safeReturnTo } from "@/lib/auth";
import styles from "../auth.module.css";

export default function LoginPage() {
  const { user, loading, setUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(safeReturnTo(new URLSearchParams(window.location.search).get("returnTo")));
    }
  }, [loading, router, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await authApi.login({
        login: String(form.get("identity") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      setUser(result.user);
      const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
      router.replace(returnTo);
      router.refresh();
    } catch (caught) {
      setError(authErrorMessage(caught));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSubmitting(false);
    }
  }

  return <main className={styles.page}><section className={styles.card}>
    <div className={styles.heading}><span className="eyebrow">Chào mừng trở lại</span><h1>Đăng nhập Code Forge</h1><p>Tiếp tục với repository và các pull request của bạn.</p></div>
    {error && <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}><span aria-hidden="true">!</span><p>{error}</p></div>}
    <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
      <div className={styles.field}><label htmlFor="identity">Email hoặc username</label><input id="identity" name="identity" autoComplete="username" maxLength={320} required autoFocus /></div>
      <div className={styles.field}><label htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" autoComplete="current-password" minLength={8} maxLength={128} required /></div>
      <button className={`button buttonPrimary ${styles.submit}`} type="submit" disabled={submitting}>{submitting ? <><span className={styles.spinner} aria-hidden="true" />Đang đăng nhập…</> : "Đăng nhập"}</button>
    </form>
    <p className={styles.switch}>Chưa có tài khoản? <Link href="/register">Đăng ký miễn phí</Link></p>
  </section></main>;
}
