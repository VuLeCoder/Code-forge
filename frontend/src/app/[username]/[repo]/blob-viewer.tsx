"use client";

import { useState } from "react";
import styles from "./repository.module.css";

export type BlobData = {
  path: string; size: number; objectSha: string; commitSha: string;
  kind: "text" | "binary" | "large"; content: string | null; truncated: boolean;
};

export function BlobViewer({ data }: { data: BlobData }) {
  const content = data.content ?? "";
  const lines = content === "" ? [] : content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  const [copyStatus, setCopyStatus] = useState("");
  const isText = data.kind === "text" && data.content !== null;
  const fileName = data.path.split("/").at(-1) || "source.txt";

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus(data.truncated ? "Đã sao chép phần xem trước." : "Đã sao chép nội dung file.");
    } catch {
      setCopyStatus("Không thể sao chép. Hãy chọn và sao chép nội dung thủ công.");
    }
  }

  function downloadContent() {
    if (!isText || data.truncated) return;
    const objectUrl = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "source.txt";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return <>
    <div className={styles.blobMeta}>
      <strong>{fileName}</strong>
      <span>{data.size.toLocaleString("vi-VN")} byte</span>
      <span>{lines.length.toLocaleString("vi-VN")} {data.truncated ? "dòng xem trước" : "dòng"}</span>
      <code title={`Blob ${data.objectSha}`}>Blob {data.objectSha.slice(0, 12)}</code>
      <code title={`Commit ${data.commitSha}`}>Commit {data.commitSha.slice(0, 12)}</code>
      {isText && <div className={styles.blobActions}>
        <button className={styles.blobAction} type="button" onClick={() => void copyContent()}>{data.truncated ? "Sao chép bản xem trước" : "Sao chép mã nguồn"}</button>
        <button className={styles.blobAction} type="button" disabled={data.truncated} title={data.truncated ? "Tải xuống chỉ bật khi nội dung đầy đủ." : undefined} onClick={downloadContent}>Tải file</button>
      </div>}
    </div>
    {copyStatus && <p className={styles.blobStatus} role="status">{copyStatus}</p>}
    {data.kind === "large" ? <p className={styles.notice}>File vượt giới hạn đọc 1 MiB nên chưa thể xem nội dung.</p>
      : data.kind === "binary" ? <p className={styles.notice}>File nhị phân hoặc không phải văn bản UTF-8; không có bản xem trước.</p>
      : <>
        {data.truncated && <p className={styles.notice} role="status">Đây là bản xem trước đã cắt, tối đa 128 KiB hoặc 2.000 dòng. Nội dung file chưa được hiển thị đầy đủ.</p>}
        {content === "" ? <p className={styles.treeEmpty}>File trống.</p> : <div className={styles.codeScroll} tabIndex={0} role="region" aria-label="Mã nguồn có số dòng">
          <table className={styles.codeTable}><tbody>{lines.map((line, index) => <tr key={index}>
            <th scope="row" className={styles.lineNumber}>{index + 1}</th><td><code>{line || " "}</code></td>
          </tr>)}</tbody></table>
        </div>}
      </>}
  </>;
}
