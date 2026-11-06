import type { Metadata } from "next";
import Link from "next/link";
import { AuthProvider } from "@/components/auth-provider";
import { BrandLogo } from "@/components/brand-logo";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const themeScript = `(() => {
  try {
    const saved = localStorage.getItem("code-forge-theme");
    const theme = saved === "light" || saved === "dark"
      ? saved
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();`;

export const metadata: Metadata = {
  title: "Code Forge — Cùng nhau xây dựng",
  description: "Nền tảng lưu trữ Git và cộng tác dành cho các nhóm nhỏ.",
  icons: {
    icon: [{ url: "/code-forge.png", type: "image/png", sizes: "1254x1254" }],
    shortcut: "/code-forge.png",
    apple: "/code-forge.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><AuthProvider>
      <SiteHeader />
      {children}
      <footer className="siteFooter"><div className="container footerInner"><Link className="brand brandSmall" href="/"><BrandLogo small /><span>Code Forge</span></Link><p>Build with clarity. Ship with confidence.</p></div></footer>
    </AuthProvider></body></html>
  );
}
