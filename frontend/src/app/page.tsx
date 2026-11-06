import Link from "next/link";
import styles from "./page.module.css";
import { HomeShowcase } from "./home-showcase";
import { AnonymousOnly } from "@/components/anonymous-only";
import { SignedInDashboard } from "@/components/signed-in-dashboard";
import { repositoryPath } from "@/lib/repositories";
import { loadPublicRepositories, repositorySearchPage, repositorySearchQuery } from "@/lib/public-repositories";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const q = repositorySearchQuery(params.q);
  const page = repositorySearchPage(params.page);
  const result = await loadPublicRepositories(q, page);

  const repositories = result.status === "success" ? result.data.repositories : [];
  const hasMore = result.status === "success" ? result.data.hasMore : false;
  const pageHref = (nextPage: number) => `/?${new URLSearchParams({ ...(q ? { q } : {}), page: String(nextPage) })}#repositories`;

  return (
    <main className={styles.main}>
      <SignedInDashboard />
      <AnonymousOnly>
      <section className={styles.hero}>
        <div className={`container ${styles.heroGrid}`}>
          <div className={styles.heroContent}>
            <span className={styles.heroKicker}><span aria-hidden="true" />Không gian phát triển cho đội ngũ hiện đại</span>
            <h1>Đưa mã nguồn từ ý tưởng đến <span>sản phẩm.</span></h1>
            <p>Lưu trữ repository, review thay đổi và phối hợp cùng đội ngũ trong một quy trình rõ ràng, an toàn và tập trung.</p>
            <div className={styles.actions}>
              <Link className="button buttonPrimary" href="/register">Tạo tài khoản</Link>
              <Link className="button buttonSecondary" href="/explore">Khám phá repository</Link>
            </div>
            <div className={styles.heroBenefits} aria-label="Tính năng nổi bật">
              <span><i aria-hidden="true">✓</i> Git qua HTTPS</span>
              <span><i aria-hidden="true">✓</i> Pull request</span>
              <span><i aria-hidden="true">✓</i> Phân quyền riêng tư</span>
            </div>
          </div>
          <div className={styles.productPreview} aria-hidden="true">
            <div className={styles.previewGlow} />
            <div className={styles.codeWindow}>
              <div className={styles.windowBar}><span /><span /><span /><strong>code-forge / helix</strong></div>
              <div className={styles.previewHeader}>
                <div className={styles.previewRepoIcon}><svg viewBox="0 0 24 24"><path d="M6 3.75h9.5L19 7.25v13H6z" /><path d="M15.5 3.75v3.5H19M9 11h7m-7 3h7m-7 3h4" /></svg></div>
                <div><small>forge-demo /</small><strong>HELIX</strong></div>
                <span className={styles.previewStatus}>Public</span>
              </div>
              <div className={styles.previewToolbar}><span><svg viewBox="0 0 24 24"><path d="M6 4v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-8 9 5m0 0v-5m0 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /></svg>main</span><strong>24 commits</strong></div>
              <div className={styles.codeLines}>
                <div><em>1</em><code><b>namespace</b> helix {"{"}</code></div>
                <div><em>2</em><code>&nbsp;&nbsp;<b>class</b> TensorEngine {"{"}</code></div>
                <div><em>3</em><code>&nbsp;&nbsp;&nbsp;&nbsp;<span>public:</span></code></div>
                <div><em>4</em><code>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Tensor forward();</code></div>
                <div><em>5</em><code>&nbsp;&nbsp;{"}"};</code></div>
                <div><em>6</em><code>{"}"}</code></div>
              </div>
              <div className={styles.previewFooter}><span><i />All checks passed</span><strong>Ready to merge</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.labSection} aria-label="Khám phá Git Engine Lab">
        <div className="container">
          <HomeShowcase />
        </div>
      </section>

      <section className={styles.repositories} id="repositories" aria-labelledby="repositories-title">
        <div className="container">
          <div className={styles.sectionHeading}>
            <div>
              <span className="eyebrow">Khám phá</span>
              <h2 id="repositories-title">Repository đang được xây dựng</h2>
              <p>Theo dõi những dự án công khai mới được cập nhật trên Code Forge.</p>
            </div>
            <form className={styles.search} action="/explore" method="get">
              <label className="srOnly" htmlFor="repo-search">Tìm repository</label>
              <span className={styles.searchIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg></span>
              <input id="repo-search" name="q" defaultValue={q} placeholder="Tên repository hoặc chủ sở hữu" type="search" maxLength={100} />
              <button className="button buttonPrimary buttonSmall" type="submit" aria-label="Tìm kiếm">Tìm</button>
            </form>
          </div>

          {result.status === "error" && (
            <section className={styles.emptyCard} aria-labelledby="repository-load-error-title" role="alert">
              <h3 id="repository-load-error-title">Không thể tải danh sách repository</h3>
              <p>Dịch vụ repository đang tạm thời không phản hồi. Vui lòng kiểm tra kết nối và thử lại.</p>
              <form action="/" method="get">
                {q && <input type="hidden" name="q" value={q} />}
                <input type="hidden" name="page" value={page} />
                <button className="button buttonSecondary buttonSmall" type="submit">Thử lại</button>
              </form>
            </section>
          )}

          {result.status === "success" && repositories.length === 0 && (
            <div className={styles.emptyCard}>
              <h3>{q ? "Không tìm thấy repository phù hợp" : "Chưa có repository để hiển thị"}</h3>
              <p>{q ? "Thử từ khóa khác hoặc xóa bộ lọc tìm kiếm." : "Tạo repository đầu tiên hoặc quay lại sau khi có repository công khai."}</p>
              {q
                ? <Link className="button buttonSecondary buttonSmall" href="/">Xóa bộ lọc</Link>
                : <Link className="button buttonSecondary buttonSmall" href="/new">Tạo repository</Link>}
            </div>
          )}

          <div className={styles.repoGrid}>
            {repositories.map((repo) => (
              <article className={styles.repoCard} key={repo.id}>
                <div className={styles.cardTopBar}>
                  <div className={styles.repoIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.75h9.5L19 7.25v13H6z" /><path d="M15.5 3.75v3.5H19M9 11h7m-7 3h7m-7 3h4" /></svg></div>
                  <span className="badge">{repo.visibility === "PUBLIC" ? "Công khai" : "Riêng tư"}</span>
                </div>
                <div className={styles.repoBody}>
                  <h3 className={styles.repoTitle}>
                    <Link href={repositoryPath(repo)}><span>{repo.owner.username} / </span>{repo.name}</Link>
                  </h3>
                  <p>{repo.description || "Chưa có mô tả cho repository này."}</p>
                  <div className={styles.repoMeta}>
                    <span>
                      <i aria-hidden="true" />
                      Cập nhật {repo.updatedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(repo.updatedAt)) : "gần đây"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {result.status === "success" && (page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label="Trang repository">
              {page > 1 && <Link className={styles.pageBtn} href={pageHref(page - 1)}>← Trang trước</Link>}
              <span className={styles.pageIndicator}>Trang {page}</span>
              {hasMore && <Link className={styles.pageBtn} href={pageHref(page + 1)}>Trang sau →</Link>}
            </nav>
          )}
        </div>
      </section>
      </AnonymousOnly>
    </main>
  );
}
