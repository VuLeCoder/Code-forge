import Image from "next/image";

export function Avatar({ username, avatarUrl, className }: { username: string; avatarUrl?: string | null; className?: string }) {
  return <span className={className} aria-hidden="true">{avatarUrl ? <Image src={avatarUrl} alt="" width={256} height={256} unoptimized style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} /> : username.slice(0, 1).toUpperCase()}</span>;
}
