import Link from "next/link";
import styles from "../auth.module.css";

export default function LoginPage() {
  return <main className={styles.page}><section className={styles.card}>
    <div className={styles.heading}><span className="eyebrow">Chào mừng trở lại</span><h1>Đăng nhập Code Forge</h1><p>Tiếp tục với repository và các pull request của bạn.</p></div>
    <form className={styles.form}>
      <div className={styles.field}><label htmlFor="identity">Email hoặc username</label><input id="identity" name="identity" autoComplete="username" required /></div>
      <div className={styles.field}><label htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
      <button className={`button buttonPrimary ${styles.submit}`} type="submit">Đăng nhập</button>
    </form>
    <p className={styles.switch}>Chưa có tài khoản? <Link href="/register">Đăng ký miễn phí</Link></p>
  </section></main>;
}
