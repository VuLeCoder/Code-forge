"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { safeReturnTo } from "@/lib/auth";

function Destination({ href, children }: { href: string; children: React.ReactNode }) {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  return <Link href={`${href}?returnTo=${encodeURIComponent(returnTo)}`}>{children}</Link>;
}

export function AuthSwitchLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Suspense fallback={<Link href={href}>{children}</Link>}><Destination href={href}>{children}</Destination></Suspense>;
}
