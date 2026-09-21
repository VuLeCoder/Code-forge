import Link from "next/link";

export default function NotFound() {
  return <main className="container" style={{ paddingBlock: 64 }}>
    <h1>Không tìm thấy người dùng</h1>
    <p style={{ marginBlock: 24 }}>Hãy kiểm tra lại username trong đường dẫn.</p>
    <Link className="button buttonSecondary" href="/">Về trang chủ</Link>
  </main>;
}
