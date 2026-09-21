import Link from "next/link";
import { RequireAuth } from "@/components/require-auth";

export default function NewRepositoryPage() {
  return <main className="container" style={{ paddingBlock: 64, minHeight: "65vh" }}>
    <RequireAuth>
      <span className="eyebrow">Không gian làm việc</span>
      <h1>Tạo repository</h1>
      <p style={{ marginBlock: 24, color: "var(--muted)", lineHeight: 1.8 }}>Tính năng tạo repository đang được xây dựng và sẽ sớm có mặt.</p>
      <Link className="button buttonSecondary" href="/">Về trang chủ</Link>
    </RequireAuth>
  </main>;
}
