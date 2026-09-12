import type { Metadata } from "next";
import Link from "next/link";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = { title: "Code Forge — Cùng nhau xây dựng", description: "Nền tảng lưu trữ Git và cộng tác dành cho các nhóm nhỏ." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi"><body><AuthProvider>
      <SiteHeader />
      {children}
      <footer className="siteFooter"><div className="container footerInner"><Link className="brand brandSmall" href="/"><span className="brandMark">CF</span>Code Forge</Link><p>Một dự án Mini GitHub dành cho học tập và thử nghiệm.</p></div></footer>
    </AuthProvider></body></html>
  );
}
