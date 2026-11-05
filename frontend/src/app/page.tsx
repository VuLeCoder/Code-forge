import Link from "next/link";
import { headers } from "next/headers";
import styles from "./page.module.css";
import { repositoryPath, type RepositorySummary } from "@/lib/repositories";
import { withBackendClientIp } from "@/lib/backend-client-ip";

type RepositoryListResponse = { repositories: RepositorySummary[]; hasMore: boolean };
type RepositoryListResult =
  | { status: "success"; data: RepositoryListResponse }
  | { status: "error" };

function isRepositorySummary(value: unknown): value is RepositorySummary {
  if (!value || typeof value !== "object") return false;
  const repository = value as Partial<RepositorySummary>;
  return typeof repository.id === "string"
    && typeof repository.name === "string"
    && typeof repository.owner?.username === "string"
    && (repository.description === null || typeof repository.description === "string")
    && (repository.visibility === "PUBLIC" || repository.visibility === "PRIVATE")
    && typeof repository.updatedAt === "string"
    && typeof repository.permissions?.canRead === "boolean"
    && typeof repository.permissions?.canManage === "boolean";
}

function isRepositoryListResponse(value: unknown): value is RepositoryListResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<RepositoryListResponse>;
  return Array.isArray(result.repositories)
    && result.repositories.every(isRepositorySummary)
    && typeof result.hasMore === "boolean";
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const page = typeof params.page === "string" && /^[1-9]\d{0,2}$/.test(params.page) ? Number(params.page) : 1;
  let result: RepositoryListResult = { status: "error" };

  try {
    const query = new URLSearchParams({ page: String(page) });
    if (q) query.set("q", q);
    const configuredTimeout = Number(process.env.HOME_REPOSITORY_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 10_000;
    const response = await fetch(`${(process.env.BACKEND_URL ?? "http://localhost:4000").replace(/\/$/, "")}/api/v1/repositories?${query}`, {
      headers: withBackendClientIp(await headers()),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      const body: unknown = await response.json();
      if (isRepositoryListResponse(body)) result = { status: "success", data: body };
    }
  } catch {
    // Keep the page usable while clearly reporting the unavailable repository list.
  }

  const repositories = result.status === "success" ? result.data.repositories : [];
  const hasMore = result.status === "success" ? result.data.hasMore : false;
  const pageHref = (nextPage: number) => `/?${new URLSearchParams({ ...(q ? { q } : {}), page: String(nextPage) })}#repositories`;

  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <div className="container">
          <div className={styles.heroContent}>
            <span className="eyebrow">Code Forge</span>
            <h1>Lưu trữ mã nguồn, cộng tác rõ ràng.</h1>
            <p>Tạo repository, làm việc qua pull request và quản lý quyền truy cập trong một không gian gọn, tập trung vào dự án của bạn.</p>
            <div className={styles.actions}>
              <Link className="button buttonPrimary" href="/register">Tạo tài khoản</Link>
              <a className="button buttonSecondary" href="#repositories">Khám phá repository</a>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.repositories} id="repositories" aria-labelledby="repositories-title">
        <div className="container">
          <div className={styles.sectionHeading}>
            <div>
              <span className="eyebrow">Cộng đồng</span>
              <h2 id="repositories-title">Repository mới cập nhật</h2>
              <p>Tìm repository công khai theo tên hoặc chủ sở hữu.</p>
            </div>
            <form className={styles.search} action="/" method="get">
              <label className="srOnly" htmlFor="repo-search">Tìm repository</label>
              <span className={styles.searchIcon} aria-hidden="true">⌕</span>
              <input id="repo-search" name="q" defaultValue={q} placeholder="Tên repository hoặc chủ sở hữu" type="search" maxLength={100} />
              <button className="button buttonPrimary buttonSmall" type="submit" aria-label="Tìm kiếm">Tìm</button>
            </form>
          </div>

          {result.status === "error" && (
            <section className={styles.emptyCard} aria-labelledby="repository-load-error-title" role="alert">
              <h3 id="repository-load-error-title">Không thể tải danh sách repository</h3>
              <p>Kiểm tra kết nối rồi thử lại. Máy chủ demo có thể cần thời gian để khởi động.</p>
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
                  <div className={styles.repoIcon} aria-hidden="true">⌘</div>
                  <span className="badge">{repo.visibility === "PUBLIC" ? "Công khai" : "Riêng tư"}</span>
                </div>
                <div className={styles.repoBody}>
                  <h3 className={styles.repoTitle}>
                    <Link href={repositoryPath(repo)}><span>{repo.owner.username} / </span>{repo.name}</Link>
                  </h3>
                  <p>{repo.description || "Chưa có mô tả cho repository này."}</p>
                  <div className={styles.repoMeta}>
                    <span className={styles.timeMeta}>
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

          <aside className={styles.demoNote}>
            <span className={styles.noteIcon} aria-hidden="true">i</span>
            <p><strong>Đây là môi trường demo.</strong> Lần mở đầu có thể chậm khi máy chủ vừa thức dậy. Git storage không bền vững, nên mã nguồn repository có thể bị khởi tạo lại.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
