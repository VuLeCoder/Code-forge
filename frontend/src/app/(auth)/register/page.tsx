import Link from "next/link";
import styles from "../auth.module.css";

export default function RegisterPage() {
  return <main className={styles.page}><section className={styles.card}>
    <div className={styles.heading}><span className="eyebrow">Bắt đầu xây dựng</span><h1>Tạo tài khoản</h1><p>Miễn phí cho dự án cá nhân và nhóm nhỏ.</p></div>
    <form className={styles.form}>
      <div className={styles.field}><label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" minLength={3} required /><span className={styles.hint}>Dùng chữ, số, dấu gạch ngang hoặc gạch dưới.</span></div>
      <div className={styles.field}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className={styles.field}><label htmlFor="password">Mật khẩu</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required /><span className={styles.hint}>Tối thiểu 8 ký tự.</span></div>
      <button className={`button buttonPrimary ${styles.submit}`} type="submit">Tạo tài khoản</button>
    </form>
    <p className={styles.switch}>Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
  </section></main>;
}
