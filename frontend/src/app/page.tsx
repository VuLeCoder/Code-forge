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
      {/* Background Ambient Glow & Grid Mesh */}
      <div className={styles.bgMesh} aria-hidden="true">
        <div className={styles.glowIndigo} />
        <div className={styles.glowCyan} />
        <div className={styles.glowAmber} />
        <div className={styles.gridOverlay} />
      </div>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroContent}>
            <div className={styles.eyebrowBadge}>
              <span className={styles.badgePulse} />
              <span className={styles.badgeText}>Code Forge 2.0 • Nền tảng Git Hosting thế hệ mới</span>
              <span className={styles.badgeArrow}>✦</span>
            </div>

            <h1 className={styles.heroTitle}>
              Nơi dòng code trở thành <br />
              <span className={styles.gradientTitle}>kiệt tác cộng tác</span>.
            </h1>

            <p className={styles.heroLead}>
              Khởi tạo repository tức thì, làm việc mượt mà qua Pull Request và quản lý quyền truy cập chuẩn Enterprise trong một giao diện lộng lẫy, tốc độ và an toàn tuyệt đối.
            </p>

            <div className={styles.actions}>
              <Link className="button buttonPrimary" href="/register">
                <span>Bắt đầu miễn phí</span>
                <span className={styles.btnArrow} aria-hidden="true">→</span>
              </Link>
              <a className="button buttonSecondary" href="#repositories">
                <span>Khám phá repository</span>
                <span className={styles.btnIcon} aria-hidden="true">⌕</span>
              </a>
            </div>

            {/* Quick Metrics Bar */}
            <div className={styles.metricsBar}>
              <div className={styles.metricItem}>
                <strong>100%</strong>
                <span>Native Git Core</span>
              </div>
              <div className={styles.metricDivider} aria-hidden="true" />
              <div className={styles.metricItem}>
                <strong>&lt; 15ms</strong>
                <span>Tốc độ định tuyến</span>
              </div>
              <div className={styles.metricDivider} aria-hidden="true" />
              <div className={styles.metricItem}>
                <strong>Zero-Trust</strong>
                <span>Bảo mật quyền PAT</span>
              </div>
              <div className={styles.metricDivider} aria-hidden="true" />
              <div className={styles.metricItem}>
                <strong>Auto-Sync</strong>
                <span>Dung hòa PR tự động</span>
              </div>
            </div>
          </div>

          {/* Interactive Developer Showcase Card */}
          <div className={styles.heroVisual} aria-hidden="true">
            <div className={styles.showcaseGlow} />
            <div className={styles.showcaseCard}>
              <div className={styles.windowBar}>
                <div className={styles.windowControls}>
                  <span className={styles.dotRed} />
                  <span className={styles.dotYellow} />
                  <span className={styles.dotGreen} />
                </div>
                <div className={styles.windowTabActive}>
                  <span className={styles.gitIcon}>⎇</span>
                  <span>codeforge / platform-core</span>
                  <span className={styles.activeDot} />
                </div>
                <div className={styles.windowTag}>production</div>
              </div>

              <div className={styles.codeSnippet}>
                <div className={styles.codeLine}>
                  <span className={styles.lineNum}>01</span>
                  <span className={styles.tokenKeyword}>git</span>
                  <span className={styles.tokenText}> remote add origin</span>
                  <span className={styles.tokenString}> https://codeforge.dev/alice/hello-world.git</span>
                </div>
                <div className={styles.codeLine}>
                  <span className={styles.lineNum}>02</span>
                  <span className={styles.tokenKeyword}>git</span>
                  <span className={styles.tokenText}> push -u origin main</span>
                </div>
                <div className={styles.codeLineSuccess}>
                  <span className={styles.lineNum}>03</span>
                  <span className={styles.tokenSuccess}>✓ Enumerating objects: 42, done. Delta compression using 8 threads.</span>
                </div>
                <div className={styles.codeLineSuccess}>
                  <span className={styles.lineNum}>04</span>
                  <span className={styles.tokenSuccess}>✓ Total 42 (delta 18), pack-reused 0 (from 82f3514)</span>
                </div>
                <div className={styles.codeLineAccent}>
                  <span className={styles.lineNum}>05</span>
                  <span className={styles.tokenAccent}>✦ Create Pull Request: https://codeforge.dev/alice/hello-world/pulls/new</span>
                </div>
              </div>

              <div className={styles.showcaseFooter}>
                <div className={styles.footerCommit}>
                  <span className={styles.commitAvatar}>A</span>
                  <span>Commit <strong>82f3514</strong> bởi <strong>alice</strong></span>
                </div>
                <div className={styles.footerStatus}>
                  <span className={styles.statusLive}>● CI Passed</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Grid Features Section */}
      <section className={styles.bentoSection}>
        <div className="container">
          <div className={styles.bentoHeading}>
            <div className={styles.sectionBadge}>
              <span className={styles.sparkle}>✦</span>
              <span>Kiến trúc vượt trội</span>
            </div>
            <h2>Được thiết kế cho kỹ sư phần mềm hiện đại</h2>
            <p>Mọi tính năng đều được tối ưu hóa cho tốc độ, tính trực quan và khả năng mở rộng không giới hạn.</p>
          </div>

          <div className={styles.bentoGrid}>
            {/* Bento Card 1: Native Git Speed */}
            <div className={`${styles.bentoCard} ${styles.cardWide}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardIconBox}>⚡</div>
                <div>
                  <h3>Hiệu năng Native Git CLI siêu tốc</h3>
                  <p>Thực thi trực tiếp qua Git engine tối ưu hóa, không có lớp trừu tượng chậm chạp.</p>
                </div>
              </div>
              <div className={styles.cardVisualGit}>
                <div className={styles.gitGraphRow}>
                  <span className={styles.graphNodeMain}>main</span>
                  <span className={styles.graphConnector} />
                  <span className={styles.graphNodeFeature}>feature/rad</span>
                  <span className={styles.graphConnector} />
                  <span className={styles.graphNodeMerge}>✓ merged</span>
                </div>
                <div className={styles.gitSpeedTag}>Thời gian phản hồi &lt; 15ms</div>
              </div>
            </div>

            {/* Bento Card 2: Zero-Trust PAT */}
            <div className={styles.bentoCard}>
              <div className={styles.cardIconBox}>🔒</div>
              <h3>Zero-Trust PAT Security</h3>
              <p>Mã hóa cá nhân hóa với thời hạn tự động thu hồi và phân quyền chi tiết từng hành động.</p>
              <div className={styles.tokenPillGroup}>
                <span className={styles.scopeTag}>repo:read</span>
                <span className={styles.scopeTag}>repo:write</span>
                <span className={styles.scopeTagActive}>admin:scope</span>
              </div>
            </div>

            {/* Bento Card 3: Pull Request Review */}
            <div className={styles.bentoCard}>
              <div className={styles.cardIconBox}>🌿</div>
              <h3>Pull Request & Diffs</h3>
              <p>So sánh thay đổi mã nguồn trực quan, tự động cảnh báo xung đột stale version.</p>
              <div className={styles.diffPreview}>
                <div className={styles.diffLinePlus}>+ const forge = new CodeForge();</div>
                <div className={styles.diffLineMinus}>- const legacy = legacyGit();</div>
              </div>
            </div>

            {/* Bento Card 4: Ecosystem & Integrations */}
            <div className={`${styles.bentoCard} ${styles.cardFull}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardIconBox}>🚀</div>
                <div>
                  <h3>Hệ sinh thái công nghệ hàng đầu</h3>
                  <p>Xây dựng trên nền tảng Full-Stack mạnh mẽ nhất hiện nay.</p>
                </div>
              </div>
              <div className={styles.stackPills}>
                <span className={styles.stackPill}>⚡ Next.js 16 App Router</span>
                <span className={styles.stackPill}>🔷 TypeScript 5 Strict</span>
                <span className={styles.stackPill}>🐘 PostgreSQL 17</span>
                <span className={styles.stackPill}>▲ Prisma ORM 6</span>
                <span className={styles.stackPill}>📦 Docker & Linux Git</span>
                <span className={styles.stackPill}>🛡️ Playwright WCAG 2.1 AA</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Repositories Community Section */}
      <section className={styles.repositories} id="repositories">
        <div className="container">
          <div className={styles.sectionHeading}>
            <div>
              <div className={styles.sectionBadge}>
                <span className={styles.sparkle}>✦</span>
                <span>Khám phá cộng đồng</span>
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

          {loadError && (
            <div role="alert" className={styles.alertCard}>
              <span className={styles.alertIcon}>⚠️</span>
              <p>Không thể tải danh sách repository lúc này. Vui lòng thử lại sau.</p>
            </div>
          )}

          {!loadError && !repositories.length && (
            <div className={styles.emptyCard}>
              <div className={styles.emptyIcon}>◇</div>
              <h3>{q ? "Không tìm thấy kết quả" : "Chưa có repository"}</h3>
              <p>{q ? "Không tìm thấy repository phù hợp." : "Chưa có repository công khai nào được chia sẻ."}</p>
            </div>
          )}

          <div className={styles.repoGrid}>
            {repositories.map((repo) => (
              <article className={styles.repoCard} key={repo.id}>
                <div className={styles.cardTopBar}>
                  <div className={styles.repoIcon} aria-hidden="true">
                    <span>⌘</span>
                  </div>
                  <span className="badge">Công khai</span>
                </div>
                <div className={styles.repoBody}>
                  <div className={styles.repoTitle}>
                    <Link href={repositoryPath(repo)}>
                      <span>{repo.owner.username} / </span>{repo.name}
                    </Link>
                  </div>
                  <p>{repo.description || "Chưa có mô tả cho repository này."}</p>
                  <div className={styles.repoMeta}>
                    <span className={styles.langIndicator}>
                      <i className={styles.langDot} aria-hidden="true" />
                      <span>TypeScript</span>
                    </span>
                    <span className={styles.timeMeta}>
                      Cập nhật {repo.updatedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(repo.updatedAt)) : "gần đây"}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {!loadError && (page > 1 || hasMore) && (
            <nav className={styles.pagination} aria-label="Trang repository">
              {page > 1 && <Link className={styles.pageBtn} href={pageHref(page - 1)}>← Trang trước</Link>}
              <span className={styles.pageIndicator}>Trang {page}</span>
              {hasMore && <Link className={styles.pageBtn} href={pageHref(page + 1)}>Trang sau →</Link>}
            </nav>
          )}

          <div className={styles.demoNote}>
            <div className={styles.noteIconCircle}>
              <span className={styles.noteIcon} aria-hidden="true">ⓘ</span>
            </div>
            <p><strong>Đây là môi trường demo.</strong> Lần mở đầu có thể chậm khi máy chủ vừa thức dậy. Git storage không bền vững, nên mã nguồn repository có thể bị khởi tạo lại.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
