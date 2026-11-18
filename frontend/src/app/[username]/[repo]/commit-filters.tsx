"use client";

import { Select } from "@/components/select";


import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { sessionFetch } from "@/lib/auth";
import { useAuth } from "@/components/auth-provider";
import { RepositoryIcon } from "./repository-icon";
import styles from "./repository.module.css";

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CommitFilters({ endpoint }: { endpoint: string }) {
  const query = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const identity = `${endpoint}:${user?.id ?? "anonymous"}`;
  const [result, setResult] = useState<{ key: string; authors?: { username: string }[] }>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const [month, setMonth] = useState(() => new Date());
  const [start, setStart] = useState("");
  const [hover, setHover] = useState("");
  const calendar = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    sessionFetch(`${endpoint}/commit-authors`, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Không thể tải thành viên");
      const body = await response.json();
      if (!controller.signal.aborted) setResult({ key: identity, authors: body.authors });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key: identity }); });
    return () => controller.abort();
  }, [endpoint, identity, attempt]);
  useEffect(() => {
    function close(event: MouseEvent) { if (calendar.current && !calendar.current.contains(event.target as Node)) calendar.current.open = false; }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  function apply(values: { author?: string; since?: string; until?: string }) {
    const next = new URLSearchParams(query.toString());
    for (const [name, value] of Object.entries(values)) { if (value) next.set(name, value); else next.delete(name); }
    for (const name of ["page", "snapshot", "sha"]) next.delete(name);
    next.set("view", "commits");
    router.push(`${pathname}?${next}`, { scroll: false });
  }
  const since = query.get("since") ?? "";
  const until = query.get("until") ?? "";
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - first.getDay() + 1));
  const rangeStart = start ? (hover && hover < start ? hover : start) : since;
  const rangeEnd = start ? (hover > start ? hover : start) : until;
  const authors = result.key === identity ? result.authors : undefined;
  return <div className={styles.historyFilters}>
    <label className={styles.authorSelect}><span className={styles.visuallyHidden}>Tác giả</span><Select aria-label="Tác giả" value={query.get("author") ?? ""} onChange={event => apply({ author: event.target.value })}>
      <option value="">Tất cả người dùng</option>
      {authors?.map(author => <option key={author.username} value={author.username}>{author.username}</option>)}
    </Select></label>
    {result.key === identity && !authors && <button type="button" onClick={() => setAttempt(value => value + 1)}>Tải lại thành viên</button>}
    <details ref={calendar} className={styles.datePicker} onToggle={event => { if (!event.currentTarget.open) { setStart(""); setHover(""); } }} onKeyDown={event => { if (event.key === "Escape" && calendar.current) { calendar.current.open = false; calendar.current.querySelector("summary")?.focus(); } }}>
      <summary className="dropdownTrigger" aria-label="Lọc theo thời gian">▦ {since || until ? `${since || "…"} — ${until || "…"}` : "Tất cả thời gian"}<RepositoryIcon name="chevron" className="dropdownChevron" /></summary>
      <div className={styles.calendar} aria-label="Chọn khoảng ngày">
        <div className={styles.calendarHeader}>
          <Select aria-label="Tháng" value={month.getMonth()} onChange={event => setMonth(new Date(month.getFullYear(), Number(event.target.value), 1))}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>Tháng {index + 1}</option>)}</Select>
          <input aria-label="Năm" type="number" min="1970" max="9999" value={month.getFullYear()} onChange={event => { const year = Number(event.target.value); if (year >= 1970 && year <= 9999) setMonth(new Date(year, month.getMonth(), 1)); }} />
          <button type="button" aria-label="Tháng trước" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <button type="button" aria-label="Tháng sau" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </div>
        <p className={styles.calendarHint} role="status">{start ? "Chọn ngày kết thúc" : "Chọn ngày bắt đầu · UTC+7"}</p>
        <div className={styles.calendarGrid}>
          {["CN", "T2", "T3", "T4", "T5", "T6", "T7"].map(day => <span key={day}>{day}</span>)}
          {days.map(day => { const value = dateKey(day); return <button key={value} type="button" aria-label={value} aria-pressed={Boolean(rangeStart && rangeEnd && value >= rangeStart && value <= rangeEnd)} aria-current={value === dateKey(new Date()) ? "date" : undefined} data-outside={day.getMonth() !== month.getMonth()} data-edge={value === rangeStart || value === rangeEnd} onMouseEnter={() => setHover(value)} onFocus={() => setHover(value)} onClick={() => {
            if (!start) { setStart(value); setHover(value); }
            else { apply({ since: value < start ? value : start, until: value < start ? start : value }); if (calendar.current) calendar.current.open = false; setStart(""); setHover(""); }
          }}>{day.getDate()}</button>; })}
        </div>
        <div className={styles.calendarFooter}><button type="button" onClick={() => { apply({ since: "", until: "" }); if (calendar.current) calendar.current.open = false; }}>Xóa</button><button type="button" onClick={() => { const today = dateKey(new Date()); apply({ since: today, until: today }); if (calendar.current) calendar.current.open = false; }}>Hôm nay</button></div>
      </div>
    </details>
  </div>;
}
