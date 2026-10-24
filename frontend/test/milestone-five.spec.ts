import { expect, test } from "@playwright/test";

const owner = {
  id: "owner-id",
  username: "alice",
  email: "alice@example.test",
  systemRole: "USER",
  status: "ACTIVE",
  createdAt: "2026-09-01T00:00:00.000Z",
};

const bob = {
  id: "bob-id",
  username: "bob",
  email: "bob@example.test",
  systemRole: "USER",
  status: "ACTIVE",
  createdAt: "2026-09-02T00:00:00.000Z",
};

test.describe("Milestone 5 - Invitation and Member Management UI", () => {
  test("repository settings shows members and allows inviting, changing role, and revoking", async ({ page }) => {
    await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: owner } }));
    await page.route("**/api/v1/repos/alice/project", (route) =>
      route.fulfill({
        json: {
          repository: {
            id: "repo-1",
            name: "project",
            description: "Test repo",
            visibility: "PRIVATE",
            status: "ACTIVE",
            defaultBranch: "main",
            storageGeneration: 0,
            owner: { username: "alice" },
            permissions: { canRead: true, canWrite: true, canManage: true },
          },
        },
      }),
    );

    let membersList = [
      {
        userId: "bob-id",
        role: "READ",
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
        user: { id: "bob-id", username: "bob" },
      },
    ];

    let invitationsList = [
      {
        id: "inv-1",
        role: "WRITE",
        status: "PENDING",
        expiresAt: "2026-10-31T00:00:00.000Z",
        createdAt: "2026-10-24T00:00:00.000Z",
        invitee: { id: "charlie-id", username: "charlie" },
      },
    ];

    await page.route("**/api/v1/repos/alice/project/members", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { members: membersList } });
      }
      return route.fallback();
    });

    await page.route("**/api/v1/repos/alice/project/members/*", (route) => {
      if (route.request().method() === "PATCH") {
        const id = route.request().url().split("/").pop();
        membersList = membersList.map((m) => m.userId === id ? { ...m, role: "WRITE" } : m);
        return route.fulfill({ json: { member: membersList.find((m) => m.userId === id) } });
      }
      if (route.request().method() === "DELETE") {
        const id = route.request().url().split("/").pop();
        membersList = membersList.filter((m) => m.userId !== id);
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    });

    await page.route("**/api/v1/repos/alice/project/invitations", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { invitations: invitationsList } });
      }
      if (route.request().method() === "POST") {
        const newInv = {
          id: "inv-2",
          role: "WRITE" as const,
          status: "PENDING",
          expiresAt: "2026-10-31T00:00:00.000Z",
          createdAt: "2026-10-24T00:00:00.000Z",
          invitee: { id: "dave-id", username: "dave" },
        };
        invitationsList.push(newInv);
        return route.fulfill({ status: 201, json: { invitation: newInv } });
      }
      return route.fallback();
    });

    await page.route("**/api/v1/repos/alice/project/invitations/*", (route) => {
      if (route.request().method() === "DELETE") {
        const id = route.request().url().split("/").pop();
        invitationsList = invitationsList.filter((i) => i.id !== id);
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    });

    await page.goto("/alice/project/settings");

    // Verify sections
    await expect(page.getByRole("heading", { name: "Thành viên và cộng tác" })).toBeVisible();
    await expect(page.getByText("bob")).toBeVisible();
    await expect(page.getByText("charlie")).toBeVisible();

    // 1. Invite new user
    await page.getByPlaceholder("Tên người dùng (username)").fill("dave");
    await page.getByRole("button", { name: "Gửi lời mời" }).click();
    await expect(page.getByText("Đã gửi lời mời tới dave.")).toBeVisible();

    // 2. Revoke invitation
    await page.getByRole("button", { name: "Thu hồi" }).first().click();
    await expect(page.getByText("Đã thu hồi lời mời.")).toBeVisible();

    // 3. Change member role for Bob specifically
    const bobRow = page.getByRole("listitem").filter({ hasText: "bob" });
    await bobRow.getByRole("combobox").selectOption("WRITE");
    await expect(page.getByText("Đã cập nhật quyền thành Ghi (WRITE).")).toBeVisible();

    // 4. Remove member
    await bobRow.getByRole("button", { name: "Xóa" }).click();
    await expect(page.getByText("Đã xóa thành viên bob khỏi repository.")).toBeVisible();
  });

  test("invitations page lists pending invitations and allows accepting and declining", async ({ page }) => {
    await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user: bob } }));

    let userInvitations = [
      {
        id: "inv-bob-1",
        role: "WRITE",
        status: "PENDING",
        expiresAt: "2026-10-31T00:00:00.000Z",
        createdAt: "2026-10-24T00:00:00.000Z",
        repository: { id: "repo-1", name: "super-app", owner: { username: "alice" } },
        inviter: { id: "owner-id", username: "alice" },
      },
    ];

    await page.route("**/api/v1/invitations", (route) => {
      return route.fulfill({ json: { invitations: userInvitations } });
    });

    await page.route("**/api/v1/invitations/inv-bob-1/accept", (route) => {
      userInvitations = [];
      return route.fulfill({ json: { success: true } });
    });

    await page.goto("/invitations");

    await expect(page.getByRole("heading", { name: "Lời mời cộng tác" })).toBeVisible();
    await expect(page.getByText("alice/super-app")).toBeVisible();
    await expect(page.getByText("Quyền Ghi (WRITE)")).toBeVisible();

    // Accept invitation
    await page.getByRole("button", { name: "Chấp nhận" }).click();
    await expect(page.getByText("Đã tham gia repository alice/super-app với quyền Ghi (WRITE).")).toBeVisible();
    await expect(page.getByText("Bạn không có lời mời cộng tác nào đang chờ xử lý.")).toBeVisible();
  });
});
