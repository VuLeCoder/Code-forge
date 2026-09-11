import Link from "next/link";
import styles from "./page.module.css";

const repositories = [
  { owner: "minhnguyen", name: "taskflow", description: "Ứng dụng quản lý công việc gọn nhẹ dành cho các nhóm nhỏ.", language: "TypeScript", updatedAt: "2 giờ trước" },
  { owner: "thuha", name: "vietnamese-nlp-notes", description: "Ghi chú và ví dụ thực hành xử lý ngôn ngữ tự nhiên tiếng Việt.", language: "Python", updatedAt: "hôm qua" },
  { owner: "codeforge", name: "design-system", description: "Các component và nguyên tắc giao diện dùng chung cho Code Forge.", language: "CSS", updatedAt: "3 ngày trước" },
];

export default function Home() {
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
            <label className={styles.search}><span className="srOnly">Tìm repository</span><span aria-hidden="true">⌕</span><input placeholder="Tìm theo tên hoặc chủ sở hữu" type="search" /></label>
          </div>
          <div className={styles.repoGrid}>
            {repositories.map((repo) => (
              <article className={styles.repoCard} key={`${repo.owner}/${repo.name}`}>
                <div className={styles.repoIcon} aria-hidden="true">◇</div>
                <div className={styles.repoBody}>
                  <div className={styles.repoTitle}><Link href={`/${repo.owner}/${repo.name}`}><span>{repo.owner} / </span>{repo.name}</Link><span className="badge">Public</span></div>
                  <p>{repo.description}</p>
                  <div className={styles.repoMeta}><span><i />{repo.language}</span><span>Cập nhật {repo.updatedAt}</span></div>
                </div>
              </article>
            ))}
          </div>
          <div className={styles.demoNote}><span aria-hidden="true">ⓘ</span><p><strong>Đây là môi trường demo.</strong> Mã nguồn repository có thể được khởi tạo lại sau khi máy chủ nghỉ.</p></div>
        </div>
      </section>
    </main>
  );
}
