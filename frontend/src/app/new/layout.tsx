import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tạo repository mới | Code Forge",
  description: "Tạo repository mới trên Code Forge.",
};

export default function NewRepositoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
