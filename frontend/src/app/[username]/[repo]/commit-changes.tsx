"use client";

import { useState } from "react";
import styles from "./commit-changes.module.css";

export type CommitChangesData = { baseSha: string | null; status: "READY" | "LIMIT_EXCEEDED" | "UNAVAILABLE"; files: {
  path: string; previousPath?: string; status: string;
  diffStatus: "TEXT" | "BINARY" | "TRUNCATED" | "UNAVAILABLE"; diff?: string;
}[] };

type Row = { kind: "meta" | "added" | "removed" | "context"; text: string; old?: number; next?: number };
function parseDiff(diff: string): Row[] {
  let old = 0, next = 0, inHunk = false;
  const rows: Row[] = [];
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      old = Number(hunk[1]); next = Number(hunk[2]); inHunk = true;
      rows.push({ kind: "meta", text: line });
    } else if (inHunk && line.startsWith("+")) rows.push({ kind: "added", text: line, next: next++ });
    else if (inHunk && line.startsWith("-")) rows.push({ kind: "removed", text: line, old: old++ });
    else if (inHunk && line.startsWith(" ")) rows.push({ kind: "context", text: line, old: old++, next: next++ });
    else if (inHunk && line.startsWith("\\")) rows.push({ kind: "meta", text: line });
  }
  return rows;
}
const labels: Record<string, string> = { A: "Thêm", D: "Xóa", R: "Đổi tên", M: "Sửa", T: "Đổi loại", C: "Sao chép" };

export function CommitChanges({ changes }: { changes?: CommitChangesData }) {
  const [filter, setFilter] = useState("");
  const files = (changes?.files ?? []).map((file, index) => {
    const rows = parseDiff(file.diff ?? "");
    return { ...file, id: `commit-change-${index}`, rows, added: rows.filter(row => row.kind === "added").length, removed: rows.filter(row => row.kind === "removed").length };
  });
  const visible = files.filter(file => `${file.path}\n${file.previousPath ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  if (!changes || changes.status !== "READY") return <section aria-label="Thay đổi trong commit"><h3>Thay đổi trong commit</h3><p role="status">{changes?.status === "LIMIT_EXCEEDED" ? "Commit vượt giới hạn 200 file hoặc dung lượng danh sách file. Hãy xem đầy đủ bằng Git clone." : "Chưa thể tải thay đổi. Hãy tải lại trang để thử lại."}</p></section>;
  const partial = files.some(file => file.diffStatus !== "TEXT");
  return <section aria-label="Thay đổi trong commit" className={styles.changes}>
    <header className={styles.overview}><h3>{files.length} file thay đổi</h3><span><span className={styles.added}>+{files.reduce((sum, file) => sum + file.added, 0)}</span>{" "}<span className={styles.removed}>−{files.reduce((sum, file) => sum + file.removed, 0)}</span>{partial && " (phần văn bản hiển thị)"}</span></header>
    <p>{changes.baseSha ? `So với commit cha đầu tiên ${changes.baseSha.slice(0, 7)}.` : "Commit đầu tiên: các file được tạo mới."}</p>
    {!files.length ? <p>Commit này không thay đổi file.</p> : <div className={styles.workspace}>
      <nav className={styles.sidebar} aria-label="File thay đổi">
        <label htmlFor="commit-file-filter">Lọc file</label>
        <input id="commit-file-filter" type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Lọc theo tên file…" />
        <ul>{visible.map(file => <li key={file.path}><a href={`#${file.id}`}><span className={styles.status}>{labels[file.status] ?? file.status}</span><span>{file.path}</span></a></li>)}</ul>
      </nav>
      <div className={styles.files}>
        {!visible.length && <p role="status">Không có file phù hợp.</p>}
        {visible.map(file => <details open key={file.path} id={file.id} className={styles.file}>
          <summary><span className={styles.fileName}>{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}</span><span className={styles.status}>{labels[file.status] ?? file.status}</span>{file.diffStatus === "TEXT" && <span className={styles.stats}><span className={styles.added}>+{file.added}</span>{" "}<span className={styles.removed}>−{file.removed}</span></span>}</summary>
          {file.diffStatus === "TEXT" && file.rows.length > 0 ? <div className={styles.scroll} tabIndex={0} role="region" aria-label={`Diff của ${file.path}`}><table><thead className={styles.srOnly}><tr><th>Dòng cũ</th><th>Dòng mới</th><th>Nội dung thay đổi</th></tr></thead><tbody>{file.rows.map((row, index) => <tr key={index} className={styles[row.kind]}><td className={styles.number}>{row.old}</td><td className={styles.number}>{row.next}</td><td className={styles.code}>{row.text}</td></tr>)}</tbody></table></div>
            : <p className={styles.notice}>{file.diffStatus === "BINARY" ? "File nhị phân: không hiển thị diff văn bản." : file.diffStatus === "TRUNCATED" ? "Diff vượt giới hạn hiển thị. Hãy xem đầy đủ bằng Git clone." : file.diffStatus === "UNAVAILABLE" ? "Không hiển thị diff do giới hạn tổng dung lượng của commit." : "Không có thay đổi nội dung văn bản (chỉ đổi tên hoặc thuộc tính file)."}</p>}
        </details>)}
      </div>
    </div>}
  </section>;
}
