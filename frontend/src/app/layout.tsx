import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Code Forge — Cùng nhau xây dựng", description: "Nền tảng lưu trữ Git và cộng tác dành cho các nhóm nhỏ." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi"><body>
      <header className="siteHeader"><div className="headerInner">
        <Link className="brand" href="/" aria-label="Code Forge - Trang chủ"><span className="brandMark" aria-hidden="true">CF</span><span>Code Forge</span></Link>
        <nav className="mainNav" aria-label="Điều hướng chính"><Link href="/#repositories">Khám phá</Link><Link href="/new">Tạo repository</Link></nav>
        <div className="headerActions"><Link className="textLink" href="/login">Đăng nhập</Link><Link className="button buttonPrimary buttonSmall" href="/register">Đăng ký</Link></div>
      </div></header>
      {children}
      <footer className="siteFooter"><div className="container footerInner"><Link className="brand brandSmall" href="/"><span className="brandMark">CF</span>Code Forge</Link><p>Một dự án Mini GitHub dành cho học tập và thử nghiệm.</p></div></footer>
    </body></html>
  );
}
