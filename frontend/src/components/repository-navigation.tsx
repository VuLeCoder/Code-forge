"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionFetch } from "@/lib/auth";

type RepositoryNavigationProps = {
  owner: string;
  repository: string;
  current: "code" | "pulls" | "settings";
  canManage?: boolean;
};

export function RepositoryNavigation({ owner, repository, current, canManage }: RepositoryNavigationProps) {
  const [permission, setPermission] = useState<{ key: string; canManage: boolean } | null>(null);
  const key = `${owner}/${repository}`;

  useEffect(() => {
    if (canManage !== undefined) return;
    const controller = new AbortController();
    let active = true;

    void sessionFetch(`/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Unable to load repository permissions.");
      const body = await response.json() as { repository?: { permissions?: { canManage?: unknown } } };
      if (typeof body.repository?.permissions?.canManage !== "boolean") {
        throw new Error("Repository permissions are unavailable.");
      }
      if (active) setPermission({ key, canManage: body.repository.permissions.canManage });
    }).catch(() => {
      if (active) setPermission({ key, canManage: false });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [owner, repository, key, canManage]);

  const showSettings = canManage ?? (permission?.key === key && permission.canManage);
  const base = `/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;

  return (
    <nav className="repositoryNav" aria-label="Điều hướng repository">
      <Link aria-current={current === "code" ? "page" : undefined} href={base}>Mã nguồn</Link>
      <Link aria-current={current === "pulls" ? "page" : undefined} href={`${base}/pulls`}>Pull requests</Link>
      {showSettings && <Link aria-current={current === "settings" ? "page" : undefined} href={`${base}/settings`}>Cài đặt</Link>}
    </nav>
  );
}
