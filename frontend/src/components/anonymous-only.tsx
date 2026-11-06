"use client";

import type { ReactNode } from "react";
import { useAuth } from "./auth-provider";

export function AnonymousOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading || user) return null;
  return children;
}
