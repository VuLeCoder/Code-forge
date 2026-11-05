import Link from "next/link";
import { headers } from "next/headers";
import styles from "./page.module.css";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import { withBackendClientIp } from "@/lib/backend-client-ip";

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
      headers: withBackendClientIp(await headers()), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Không thể tải repository.");
    ({ repositories, hasMore } = await response.json() as { repositories: RepositorySummary[]; hasMore: boolean });
  } catch { loadError = true; }
  const pageHref = (nextPage: number) => `/?${new URLSearchParams({ ...(q ? { q } : {}), page: String(nextPage) })}#repositories`;
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <div className={styles.heroAmbient} aria-hidden="true" />
        <div className="container">
          <div className={styles.heroGrid}>
            <div className={styles.heroContent}>
              <div className={styles.eyebrowPill}>
                <span className={styles.pulseDot} />
                <span>Nền tảng Git Hosting thế hệ mới</span>
              </div>
              <h1 className={styles.heroTitle}>
                Nơi dòng code trở thành <br />
                <span className={styles.gradientText}>kiệt tác cộng tác</span>.
              </h1>
              <p className={styles.heroLead}>
                Khởi tạo repository, đồng bộ mã nguồn chuẩn Git và cộng tác qua pull request — tất cả trong một không gian tinh gọn, hiện đại và bảo mật.
              </p>
              <div className={styles.actions}>
                <Link className="button buttonPrimary" href="/register">
                  <span>Bắt đầu miễn phí</span>
                  <span className={styles.btnArrow} aria-hidden="true">→</span>
                </Link>
                <a className="button buttonSecondary" href="#repositories">
                  Khám phá repository
                </a>
              </div>
            </div>

            <div className={styles.heroShowcase} aria-hidden="true">
              <div className={styles.previewWindow}>
                <div className={styles.windowHeader}>
                  <div className={styles.windowDots}>
                    <span className={styles.dotRed} />
                    <span className={styles.dotYellow} />
                    <span className={styles.dotGreen} />
                  </div>
                  <div className={styles.windowAddress}>
                    <span className={styles.lockIcon}>🔒</span>
                    <span>codeforge.dev / live-workspace</span>
                  </div>
                </div>
                <div className={styles.windowBody}>
                  <div className={styles.showcaseMeta}>
                    <div className={styles.branchPill}>
                      <span className={styles.gitBranchIcon}>⎇</span>
                      <strong>main</strong>
                      <span className={styles.liveTag}>Active</span>
                    </div>
                    <span className={styles.shaPill}>82f3514</span>
                  </div>
                  <div className={styles.featurePills}>
                    <div className={styles.featurePill}>
                      <span className={styles.featIcon}>⚡</span>
                      <div>
                        <strong>Hiệu năng cao</strong>
                        <small>Native Git CLI tốc độ tối đa</small>
                      </div>
                    </div>
                    <div className={styles.featurePill}>
                      <span className={styles.featIcon}>🔒</span>
                      <div>
                        <strong>Zero-Trust PAT</strong>
                        <small>Kiểm soát quyền hạt mịn</small>
                      </div>
                    </div>
                    <div className={styles.featurePill}>
                      <span className={styles.featIcon}>🌿</span>
                      <div>
                        <strong>Pull Request</strong>
                        <small>Review diffs trực quan</small>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.repositories} id="repositories">
        <div className="container">
          <div className={styles.sectionHeading}>
            <div>
              <div className={styles.sectionBadge}>
                <span className={styles.badgeSpark}>✦</span>
                <span>Cộng đồng nhà phát triển</span>
              </div>
              <h2>Repository mới cập nhật</h2>
            </div>
            <form className={styles.search} action="/" method="get">
              <label className="srOnly" htmlFor="repo-search">Tìm repository</label>
              <span className={styles.searchIcon} aria-hidden="true">⌕</span>
              <input id="repo-search" name="q" defaultValue={q} placeholder="Tìm theo tên hoặc chủ sở hữu..." type="search" maxLength={100} />
              <button type="submit" aria-label="Tìm kiếm">Tìm kiếm</button>
            </form>
          </div>
          {loadError && <p role="alert" className={styles.alertMessage}>Không thể tải danh sách repository lúc này. Vui lòng thử lại sau.</p>}
          {!loadError && !repositories.length && <p className={styles.emptyMessage}>{q ? "Không tìm thấy repository phù hợp." : "Chưa có repository công khai."}</p>}
          <div className={styles.repoGrid}>
            {repositories.map((repo) => (
              <article className={styles.repoCard} key={repo.id}>
                <div className={styles.repoIcon} aria-hidden="true">
                  <span>⌘</span>
                </div>
                <div className={styles.repoBody}>
                  <div className={styles.repoTitle}>
                    <Link href={repositoryPath(repo)}>
                      <span>{repo.owner.username} / </span>{repo.name}
                    </Link>
                    <span className="badge">Công khai</span>
                  </div>
                  <p>{repo.description || "Chưa có mô tả cho repository này."}</p>
                  <div className={styles.repoMeta}>
                    <span className={styles.langIndicator}>
                      <i className={styles.langDot} aria-hidden="true" />
                      <span>TypeScript</span>
                    </span>
                    <span>Cập nhật {repo.updatedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(repo.updatedAt)) : "gần đây"}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!loadError && (page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label="Trang repository">
              {page > 1 && <Link href={pageHref(page - 1)}>← Trang trước</Link>}
              <span className={styles.pageNumber}>Trang {page}</span>
              {hasMore && <Link href={pageHref(page + 1)}>Trang sau →</Link>}
            </nav>
          )}
          <div className={styles.demoNote}>
            <span className={styles.noteIcon} aria-hidden="true">ⓘ</span>
            <p><strong>Đây là môi trường demo.</strong> Lần mở đầu có thể chậm khi máy chủ vừa thức dậy. Git storage không bền vững, nên mã nguồn repository có thể bị khởi tạo lại.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
