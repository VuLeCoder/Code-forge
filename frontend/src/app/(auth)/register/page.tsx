"use client";

import { AuthSwitchLink } from "@/components/auth-switch-link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authApi, authErrorMessage, safeReturnTo } from "@/lib/auth";
import styles from "../auth.module.css";

export default function RegisterPage() {
  const { user, loading, setUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(safeReturnTo(new URLSearchParams(window.location.search).get("returnTo")));
    }
  }, [loading, router, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPasswordError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setPasswordError("Mật khẩu xác nhận chưa khớp.");
      requestAnimationFrame(() => confirmRef.current?.focus());
      return;
    }

    setSubmitting(true);
    try {
      const result = await authApi.register({
        username: String(form.get("username") ?? "").trim(),
        email: String(form.get("email") ?? "").trim(),
        password,
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
    <div className={styles.heading}><span className="eyebrow">Bắt đầu xây dựng</span><h1>Tạo tài khoản</h1><p>Miễn phí cho dự án cá nhân và nhóm nhỏ.</p></div>
    {error && <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}><span aria-hidden="true">!</span><p>{error}</p></div>}
    <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
      <div className={styles.field}><label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" minLength={3} maxLength={39} pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]*[A-Za-z0-9]"} title="Bắt đầu và kết thúc bằng chữ hoặc số; ở giữa có thể dùng dấu chấm, gạch ngang, gạch dưới" required autoFocus /><span className={styles.hint}>3–39 ký tự; bắt đầu và kết thúc bằng chữ hoặc số. Cho phép dấu chấm, gạch ngang và gạch dưới ở giữa.</span></div>
      <div className={styles.field}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" maxLength={320} required /></div>
      <div className={styles.field}><label htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /><span className={styles.hint}>Từ 8 đến 128 ký tự.</span></div>
      <div className={styles.field}><label htmlFor="confirmPassword">Xác nhận mật khẩu</label><input ref={confirmRef} id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} aria-invalid={Boolean(passwordError)} aria-describedby={passwordError ? "confirm-password-error" : undefined} required />{passwordError && <span className={styles.fieldError} id="confirm-password-error">{passwordError}</span>}</div>
      <button className={`button buttonPrimary ${styles.submit}`} type="submit" disabled={submitting}>{submitting ? <><span className={styles.spinner} aria-hidden="true" />Đang tạo tài khoản…</> : "Tạo tài khoản"}</button>
    </form>
    <p className={styles.switch}>Đã có tài khoản? <AuthSwitchLink href="/login">Đăng nhập</AuthSwitchLink></p>
  </section></main>;
}
