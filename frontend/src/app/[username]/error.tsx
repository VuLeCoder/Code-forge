"use client";

export default function ProfileError({ retry }: { retry: () => void }) {
  return <main className="container" style={{ paddingBlock: 64 }}>
    <h1>Chưa thể tải hồ sơ</h1>
    <p role="alert" style={{ marginBlock: 24 }}>Máy chủ đang khởi động hoặc tạm thời gián đoạn. Vui lòng thử lại.</p>
    <button className="button buttonPrimary" onClick={retry}>Thử lại</button>
  </main>;
}
