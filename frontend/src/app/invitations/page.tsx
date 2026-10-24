"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { sessionFetch } from "@/lib/auth";
import styles from "./invitations.module.css";

type Invitation = {
  id: string;
  role: "READ" | "WRITE";
  status: string;
  expiresAt: string;
  createdAt: string;
  repository: {
    id: string;
    name: string;
    owner: { username: string };
  };
  inviter: {
    id: string;
    username: string;
  };
};

function InvitationsManager() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    sessionFetch("/api/v1/invitations", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải danh sách lời mời.");
        const data = (await response.json()) as { invitations: Invitation[] };
        if (!cancelled) setInvitations(data.invitations);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, []);

  async function handleAccept(invitation: Invitation) {
    setBusyId(invitation.id);
    setError("");
    setMessage("");

    try {
      const response = await sessionFetch(`/api/v1/invitations/${encodeURIComponent(invitation.id)}/accept`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Không thể chấp nhận lời mời.");
      }

      if (!alive.current) return;
      setInvitations((prev) => prev.filter((item) => item.id !== invitation.id));
      setMessage(`Đã tham gia repository ${invitation.repository.owner.username}/${invitation.repository.name} với quyền ${invitation.role === "WRITE" ? "Ghi (WRITE)" : "Đọc (READ)"}.`);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Không thể chấp nhận lời mời.");
    } finally {
      if (alive.current) setBusyId(null);
    }
  }

  async function handleDecline(invitation: Invitation) {
    setBusyId(invitation.id);
    setError("");
    setMessage("");

    try {
      const response = await sessionFetch(`/api/v1/invitations/${encodeURIComponent(invitation.id)}/decline`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };

      if (!response.ok) {
        throw new Error(data.error?.message ?? "Không thể từ chối lời mời.");
      }

      if (!alive.current) return;
      setInvitations((prev) => prev.filter((item) => item.id !== invitation.id));
      setMessage(`Đã từ chối lời mời vào repository ${invitation.repository.owner.username}/${invitation.repository.name}.`);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Không thể từ chối lời mời.");
    } finally {
      if (alive.current) setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1>Lời mời cộng tác</h1>
        <p>Danh sách các repository đang mời bạn tham gia cộng tác mã nguồn.</p>
      </div>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {message && <div className={styles.success} role="status">{message}</div>}

      {loading ? (
        <p role="status">Đang tải lời mời…</p>
      ) : invitations.length === 0 ? (
        <div className={styles.empty}>
          <p>Bạn không có lời mời cộng tác nào đang chờ xử lý.</p>
          <Link href="/" className="button buttonSecondary">Khám phá repository</Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {invitations.map((inv) => {
            const isBusy = busyId === inv.id;
            const repoPath = `/${encodeURIComponent(inv.repository.owner.username)}/${encodeURIComponent(inv.repository.name)}`;
            const expiresDate = new Date(inv.expiresAt).toLocaleDateString("vi-VN");

            return (
              <li key={inv.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemTitle}>
                    <Link href={repoPath}>{inv.repository.owner.username}/{inv.repository.name}</Link>
                  </span>
                  <span className="badge">Quyền {inv.role === "WRITE" ? "Ghi (WRITE)" : "Đọc (READ)"}</span>
                </div>
                <div className={styles.meta}>
                  <span>Người mời: <strong>{inv.inviter.username}</strong></span>
                  <span>Hạn phản hồi: {expiresDate}</span>
                </div>
                <div className={styles.actions}>
                  <button
                    className="button buttonPrimary buttonSmall"
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleAccept(inv)}
                    aria-label={`Chấp nhận lời mời vào ${inv.repository.owner.username}/${inv.repository.name}`}
                  >
                    {isBusy ? "Đang xử lý…" : "Chấp nhận"}
                  </button>
                  <button
                    className={styles.declineButton}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleDecline(inv)}
                    aria-label={`Từ chối lời mời vào ${inv.repository.owner.username}/${inv.repository.name}`}
                  >
                    Từ chối
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function InvitationsPage() {
  return (
    <RequireAuth>
      <main className="container">
        <InvitationsManager />
      </main>
    </RequireAuth>
  );
}
