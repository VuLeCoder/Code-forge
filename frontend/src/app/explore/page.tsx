import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicRepositories, repositorySearchPage, repositorySearchQuery } from "@/lib/public-repositories";
import { repositoryPath } from "@/lib/repositories";
import styles from "./explore.module.css";

export const metadata: Metadata = { title: "Khám phá repository | Code Forge" };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const query = repositorySearchQuery(params.q);
  const page = repositorySearchPage(params.page);
  const result = await loadPublicRepositories(query, page);
  const repositories = result.status === "success" ? result.data.repositories : [];
  const hasMore = result.status === "success" ? result.data.hasMore : false;
  const pageHref = (nextPage: number) => `/explore?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(nextPage) })}`;

  return <main className={styles.page}>
    <div className="container">
      <header className={styles.heading}>
        <div><span className="eyebrow">Khám phá</span><h1>Repository công khai</h1><p>Tìm dự án theo tên repository hoặc chủ sở hữu trên Code Forge.</p></div>
        <form className={styles.search} action="/explore" method="get" role="search">
          <label className="srOnly" htmlFor="explore-repository-search">Tìm repository</label>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
          <input id="explore-repository-search" name="q" defaultValue={query} placeholder="Tên repository hoặc chủ sở hữu" type="search" maxLength={100} />
          <button className="button buttonPrimary buttonSmall" type="submit">Tìm</button>
        </form>
      </header>

      {result.status === "error" ? <section className={styles.state} role="alert">
        <h2>Không thể tải repository</h2><p>Dịch vụ repository đang tạm thời không phản hồi.</p>
        <form action="/explore" method="get">{query && <input type="hidden" name="q" value={query} />}<button className="button buttonSecondary buttonSmall" type="submit">Thử lại</button></form>
      </section> : <>
        <div className={styles.resultHeader} aria-live="polite">
          <p>{query ? <>Kết quả cho <strong>“{query}”</strong></> : "Repository được cập nhật gần đây"}</p>
          {query && <Link href="/explore">Xóa bộ lọc</Link>}
        </div>
        {repositories.length === 0 ? <section className={styles.state}>
          <h2>Không tìm thấy repository phù hợp</h2><p>Thử tên repository, username khác hoặc xóa bộ lọc hiện tại.</p>
          <Link className="button buttonSecondary buttonSmall" href="/explore">Xem tất cả repository</Link>
        </section> : <div className={styles.results}>
          {repositories.map((repository) => <article className={styles.repository} key={repository.id}>
            <div className={styles.repoIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.75h9.5L19 7.25v13H6z" /><path d="M15.5 3.75v3.5H19M9 11h7m-7 3h7m-7 3h4" /></svg></div>
            <div className={styles.repoBody}>
              <div className={styles.repoTitle}><h2><Link href={repositoryPath(repository)}><span>{repository.owner.username} / </span>{repository.name}</Link></h2><span className="badge">Công khai</span></div>
              <p>{repository.description || "Chưa có mô tả cho repository này."}</p>
              <small>Cập nhật {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(repository.updatedAt))}</small>
            </div>
          </article>)}
        </div>}
        {(page > 1 || hasMore) && <nav className={styles.pagination} aria-label="Trang repository">
          {page > 1 ? <Link href={pageHref(page - 1)}>← Trang trước</Link> : <span />}
          <span>Trang {page}</span>
          {hasMore ? <Link href={pageHref(page + 1)}>Trang sau →</Link> : <span />}
        </nav>}
      </>}
    </div>
  </main>;
}
