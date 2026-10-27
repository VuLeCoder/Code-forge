import { expect, test } from "@playwright/test";

const user = {
  id: "header-user",
  username: "alice",
  email: "alice@example.test",
  systemRole: "USER",
  status: "ACTIVE",
  createdAt: "2026-09-01T00:00:00.000Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { user } }));
});

test("account avatar opens an accessible menu and Escape restores focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Mở menu tài khoản alice" });
  await trigger.click();

  const menu = page.getByRole("menu", { name: "Menu tài khoản" });
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: "Hồ sơ của tôi" })).toHaveAttribute("href", "/alice");
  await expect(menu.getByRole("menuitem", { name: "Lời mời cộng tác" })).toHaveAttribute("href", "/invitations");

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("account menu stays inside a narrow viewport and closes on outside click", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Mở menu tài khoản alice" }).click();
  const menu = page.getByRole("menu", { name: "Menu tài khoản" });
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await page.locator("main").click({ position: { x: 12, y: 12 } });
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
