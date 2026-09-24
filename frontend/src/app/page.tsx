import Link from "next/link";
import styles from "./page.module.css";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = typeof params.page === "string" && /^[1-9]\d{0,2}$/.test(params.page) ? Number(params.page) : 1;
  let repositories: RepositorySummary[] = [];
  let hasMore = false;
  let loadError = false;
  try {
    const query = new URLSearchParams({ page: String(page) });
    if (q) query.set("q", q);
    const response = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repositories?${query}`, {
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Không thể tải repository.");
    ({ repositories, hasMore } = await response.json() as { repositories: RepositorySummary[]; hasMore: boolean });
  } catch { loadError = true; }
  const pageHref = (nextPage: number) => `/?${new URLSearchParams({ ...(q ? { q } : {}), page: String(nextPage) })}#repositories`;
  return (
    <main>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroContent}>
            <span className="eyebrow">Xây dựng cùng nhau</span>
            <h1>Nơi những dòng code<br />trở thành sản phẩm.</h1>
            <p>Lưu trữ repository, cộng tác qua pull request và quản lý quyền truy cập — trong một không gian đơn giản, rõ ràng.</p>
            <div className={styles.actions}>
              <Link className="button buttonPrimary" href="/register">Bắt đầu miễn phí</Link>
              <a className="button buttonSecondary" href="#repositories">Khám phá repository</a>
            </div>
          </div>
          <div className={styles.codeWindow} aria-label="Ví dụ sử dụng Git">
            <div className={styles.windowBar}><span /><span /><span /><p>terminal</p></div>
            <pre><code><span className={styles.comment}># Bắt đầu cộng tác</span>{"\n"}<span className={styles.prompt}>$</span> git clone codeforge.dev/ban/du-an.git{"\n"}<span className={styles.prompt}>$</span> git checkout -b feature/y-tuong-moi{"\n"}<span className={styles.prompt}>$</span> git push origin feature/y-tuong-moi{"\n\n"}<span className={styles.success}>✓ Sẵn sàng tạo pull request</span></code></pre>
          </div>
        </div>
      </section>

      <section className={styles.repositories} id="repositories">
        <div className="container">
          <div className={styles.sectionHeading}>
            <div><span className="eyebrow">Cộng đồng</span><h2>Repository mới cập nhật</h2></div>
            <form className={styles.search} action="/" method="get"><label className="srOnly" htmlFor="repo-search">Tìm repository</label><span aria-hidden="true">⌕</span><input id="repo-search" name="q" defaultValue={q} placeholder="Tìm theo tên hoặc chủ sở hữu" type="search" maxLength={100} /><button type="submit" aria-label="Tìm kiếm">Tìm</button></form>
          </div>
          {loadError && <p role="alert">Không thể tải danh sách repository lúc này. Vui lòng thử lại sau.</p>}
          {!loadError && !repositories.length && <p>{q ? "Không tìm thấy repository phù hợp." : "Chưa có repository công khai."}</p>}
          <div className={styles.repoGrid}>
            {repositories.map((repo) => (
              <article className={styles.repoCard} key={repo.id}>
                <div className={styles.repoIcon} aria-hidden="true">◇</div>
                <div className={styles.repoBody}>
                  <div className={styles.repoTitle}><Link href={repositoryPath(repo)}><span>{repo.owner.username} / </span>{repo.name}</Link><span className="badge">Công khai</span></div>
                  <p>{repo.description || "Chưa có mô tả."}</p>
                  <div className={styles.repoMeta}><span>Cập nhật {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(repo.updatedAt))}</span></div>
                </div>
              </article>
            ))}
          </div>
          {!loadError && (page > 1 || hasMore) && <nav className={styles.pagination} aria-label="Trang repository">{page > 1 && <Link href={pageHref(page - 1)}>Trang trước</Link>}<span>Trang {page}</span>{hasMore && <Link href={pageHref(page + 1)}>Trang sau</Link>}</nav>}
          <div className={styles.demoNote}><span aria-hidden="true">ⓘ</span><p><strong>Đây là môi trường demo.</strong> Mã nguồn repository có thể được khởi tạo lại sau khi máy chủ nghỉ.</p></div>
        </div>
      </section>
    </main>
  );
}
