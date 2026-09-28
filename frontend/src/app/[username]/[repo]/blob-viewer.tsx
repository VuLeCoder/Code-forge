import styles from "./repository.module.css";

export type BlobData = {
  path: string; size: number; objectSha: string; commitSha: string;
  kind: "text" | "binary" | "large"; content: string | null; truncated: boolean;
};

export function BlobViewer({ data }: { data: BlobData }) {
  const content = data.content ?? "";
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  return <>
    <div className={styles.blobMeta}><strong>{data.path.split("/").at(-1)}</strong><span>{data.size.toLocaleString("vi-VN")} byte</span><code title={data.objectSha}>{data.objectSha.slice(0, 12)}</code></div>
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
