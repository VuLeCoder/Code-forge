"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import styles from "./page.module.css";

type LabTab = "graph" | "conflict" | "diff";

const tabs: { id: LabTab; label: string }[] = [
  { id: "graph", label: "Git DAG" },
  { id: "conflict", label: "Xung đột" },
  { id: "diff", label: "Split diff" },
];

const commits = [
  { sha: "a18d42c", message: "Khởi tạo tài liệu dự án", branch: "main", x: 78, y: 137, author: "Linh Nguyễn", age: "4 ngày trước" },
  { sha: "b604f11", message: "Thêm API tìm repository", branch: "main", x: 218, y: 137, author: "Minh Trần", age: "2 ngày trước" },
  { sha: "c79e2a4", message: "Cải thiện trạng thái tải", branch: "feature/ui-states", x: 343, y: 58, author: "An Phạm", age: "1 ngày trước" },
  { sha: "de6719b", message: "Gộp cập nhật giao diện", branch: "main", x: 484, y: 137, author: "Linh Nguyễn", age: "Hôm qua" },
];

const diffRows = [
  { oldNo: "18", newNo: "18", oldText: "export const limits = {", newText: "export const limits = {", kind: "context" },
  { oldNo: "19", newNo: "19", oldText: "  maxFiles: 100,", newText: "  maxFiles: 100,", kind: "context" },
  { oldNo: "20", newNo: "20", oldText: "  timeoutMs: 120_000,", newText: "  timeoutMs: 150_000,", kind: "changed" },
  { oldNo: "21", newNo: "21", oldText: "};", newText: "};", kind: "context" },
];

const conflictChoices = {
  feature: ["const retryLimit = 5;", "const requestTimeout = 150_000;"],
  main: ["const retryLimit = 3;", "const requestTimeout = 120_000;"],
  both: ["const retryLimit = 5;", "const requestTimeout = 120_000;"],
} as const;

export function HomeShowcase() {
  const [activeTab, setActiveTab] = useState<LabTab>("graph");
  const [selectedCommit, setSelectedCommit] = useState(1);
  const [resolution, setResolution] = useState<keyof typeof conflictChoices>("feature");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commit = commits[selectedCommit]!;

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    const nextTab = tabs[nextIndex]!;
    setActiveTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }

  function selectCommit(index: number, event: KeyboardEvent<SVGGElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelectedCommit(index);
  }

  return (
    <section className={styles.showcase} aria-label="Git Engine Lab — bản minh họa tương tác">
      <div className={styles.windowBar}>
        <div className={styles.windowDots} aria-hidden="true"><span className={styles.dotRed} /><span className={styles.dotYellow} /><span className={styles.dotGreen} /></div>
        <span className={styles.windowFilename}>code-forge / git-engine-lab</span>
        <span className={styles.windowStatus}><span /> DEMO</span>
      </div>
      <div className={styles.showcaseContent}>
        <div className={styles.showcaseHeading}>
          <div><span className={styles.showcaseEyebrow}>TRẢI NGHIỆM GIT</span><h2>Git Engine Lab</h2></div>
          <span className={styles.demoBadge}>DỮ LIỆU MINH HỌA</span>
        </div>
        <p className={styles.showcaseDescription}>Khám phá commit, xem cách giải quyết xung đột và đọc diff trong một ví dụ tương tác.</p>

        <div className={styles.labTabs} role="tablist" aria-label="Chế độ minh họa Git">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              id={`lab-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`lab-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >{tab.label}</button>
          ))}
        </div>

        {activeTab === "graph" && <div className={styles.labPanel} id="lab-panel-graph" role="tabpanel" aria-labelledby="lab-tab-graph" tabIndex={0}>
          <div className={styles.panelTitle}><strong>Commit graph</strong><span>Chọn một nút để xem chi tiết</span></div>
          <div className={styles.dagScroller}>
            <svg className={styles.dagSvg} viewBox="0 0 560 190" role="group" aria-label="Đồ thị commit minh họa">
              <path className={styles.dagMainLine} d="M78 137H218 M218 137C266 137 293 58 343 58H408 M408 58C443 58 450 137 484 137 M218 137H484" />
              <path className={styles.dagFeatureLine} d="M218 137C266 137 293 58 343 58H408 M408 58C443 58 450 137 484 137" />
              <text className={styles.dagBranchLabel} x="82" y="174">main</text>
              <text className={styles.dagFeatureLabel} x="295" y="28">feature/ui-states</text>
              {commits.map((item, index) => <g
                key={item.sha}
                className={`${styles.dagNode} ${selectedCommit === index ? styles.dagNodeSelected : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Commit ${item.sha}: ${item.message}, branch ${item.branch}`}
                aria-pressed={selectedCommit === index}
                onClick={() => setSelectedCommit(index)}
                onKeyDown={(event) => selectCommit(index, event)}
              >
                <circle cx={item.x} cy={item.y} r="11" />
                <text x={item.x} y={item.y + 28} textAnchor="middle">{item.sha.slice(0, 6)}</text>
              </g>)}
            </svg>
          </div>
          <div className={styles.commitDetail} aria-live="polite">
            <span className={styles.commitHash}>{commit.sha}</span>
            <div><strong>{commit.message}</strong><small>{commit.author} · {commit.age} · {commit.branch}</small></div>
          </div>
        </div>}

        {activeTab === "conflict" && <div className={styles.labPanel} id="lab-panel-conflict" role="tabpanel" aria-labelledby="lab-tab-conflict" tabIndex={0}>
          <div className={styles.panelTitle}><strong>Merge conflict inspector</strong><span>config.ts · minh họa</span></div>
          <div className={styles.conflictBlock}>
            <div className={styles.conflictSide}><span>Nhánh feature</span><code>const requestTimeout = 150_000;</code></div>
            <div className={styles.conflictSide}><span>Nhánh main</span><code>const requestTimeout = 120_000;</code></div>
          </div>
          <fieldset className={styles.resolutionChoices}>
            <legend>Chọn nội dung cho bản xem trước</legend>
            {(["feature", "main", "both"] as const).map((choice) => (
              <button key={choice} type="button" aria-pressed={resolution === choice} onClick={() => setResolution(choice)}>
                {choice === "feature" ? "Dùng feature" : choice === "main" ? "Dùng main" : "Kết hợp"}
              </button>
            ))}
          </fieldset>
          <div className={styles.resolutionPreview} aria-live="polite">
            <span>Bản xem trước</span>
            <code>{conflictChoices[resolution].map((line) => <span key={line}>{line}</span>)}</code>
          </div>
          <p className={styles.demoDisclaimer}>Lựa chọn chỉ cập nhật ví dụ trên trang này. Không sửa file hoặc thực hiện merge trong repository.</p>
        </div>}

        {activeTab === "diff" && <div className={styles.labPanel} id="lab-panel-diff" role="tabpanel" aria-labelledby="lab-tab-diff" tabIndex={0}>
          <div className={styles.panelTitle}><strong>Thay đổi trong limits.ts</strong><span>1 file · +1 −1</span></div>
          <div className={styles.splitDiff} aria-label="Diff minh họa dạng chia đôi">
            <div className={styles.diffColumn}>
              <div className={styles.diffColumnTitle}>Trước</div>
              {diffRows.map((row) => <div key={`old-${row.oldNo}`} className={`${styles.diffLine} ${row.kind === "changed" ? styles.diffRemoved : ""}`}><span>{row.oldNo}</span><code>{row.oldText}</code></div>)}
            </div>
            <div className={styles.diffColumn}>
              <div className={styles.diffColumnTitle}>Sau</div>
              {diffRows.map((row) => <div key={`new-${row.newNo}`} className={`${styles.diffLine} ${row.kind === "changed" ? styles.diffAdded : ""}`}><span>{row.newNo}</span><code>{row.newText}</code></div>)}
            </div>
          </div>
          <p className={styles.demoDisclaimer}>Diff trên là dữ liệu minh họa, không lấy từ repository thật.</p>
        </div>}
        <p className={styles.showcaseFoot}><span className={styles.infoMark} aria-hidden="true">i</span><span>Ví dụ tĩnh để khám phá giao diện; không đại diện cho trạng thái hoặc nội dung repository của bạn.</span></p>
      </div>
    </section>
  );
}
