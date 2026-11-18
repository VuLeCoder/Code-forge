type IconName = "branch" | "search" | "code" | "history" | "settings" | "chevron" | "copy";
const paths: Record<IconName, string> = {
  branch: "M6 3v10m0-6h8a4 4 0 0 0 4-4M6 17v4M18 3v2M9 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  code: "m8 5-7 7 7 7m8-14 7 7-7 7m-3-18-2 22",
  history: "M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-5v6l4 2",
  settings: "m9 3 1-2h4l1 2 2 1 2-.2 2 3.4-1.2 1.8v2l1.2 1.8-2 3.4-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3.4L3.2 11V9L2 7.2l2-3.4L6 4l3-1ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  chevron: "m6 9 6 6 6-6",
  copy: "M9 9h12v12H9zM5 15H2V2h13v3",
};

export function RepositoryIcon({ name, className }: { name: IconName; className?: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={paths[name]} /></svg>;
}
