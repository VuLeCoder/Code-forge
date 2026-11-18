import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`repository settings sections, default branch and merge grants in ${theme}`, async ({ page }) => {
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: { id: 'owner', username: 'alice', systemRole: 'USER' } } }));
    const repository = { id: 'repo', name: 'project', description: 'Dự án của nhóm', visibility: 'PRIVATE', status: 'ACTIVE',
      defaultBranch: 'main', protectDefaultBranch: true, owner: { username: 'alice' }, permissions: { canRead: true, canWrite: true, canManage: true } };
    const member = { userId: 'writer', role: 'WRITE', canMerge: false, user: { id: 'writer', username: 'bob' } };
    const mutations: unknown[] = [];
    await page.route('**/api/v1/repos/alice/project', route => {
      if (route.request().method() === 'PATCH') {
        const data = route.request().postDataJSON();
        mutations.push(data);
        Object.assign(repository, data);
      }
      return route.fulfill({ json: { repository } });
    });
    await page.route('**/api/v1/repos/alice/project/branches', route => route.fulfill({ json: { branches: [{ name: 'main' }, { name: 'develop' }] } }));
    await page.route('**/api/v1/repos/alice/project/members', route => route.fulfill({ json: { members: [member] } }));
    await page.route('**/api/v1/repos/alice/project/invitations', route => route.fulfill({ json: { invitations: [] } }));
    await page.route('**/api/v1/repos/alice/project/members/writer', route => {
      const data = route.request().postDataJSON();
      mutations.push(data);
      Object.assign(member, data);
      return route.fulfill({ json: { member } });
    });
    await page.goto('/alice/project/settings');
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const navigation = page.getByRole('navigation', { name: 'Các mục cài đặt' });
    await expect(navigation.getByRole('button', { name: 'Cài đặt chung' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Thành viên và cộng tác' })).toBeHidden();
    await page.getByRole('combobox', { name: 'Nhánh mặc định', exact: true }).selectOption('develop');
    await page.getByRole('button', { name: 'Đổi nhánh mặc định', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Đã cập nhật cài đặt.');
    await navigation.getByRole('button', { name: 'Luật bảo vệ nhánh' }).click();
    await expect(page.getByRole('heading', { name: 'Bảo vệ nhánh develop' })).toBeVisible();
    await page.getByRole('switch', { name: 'Ngăn push trực tiếp vào nhánh mặc định' }).click();
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Cấp quyền merge cho bob' }).click();
    await expect(page.getByRole('button', { name: 'Thu hồi quyền merge của bob' })).toBeVisible();
    await page.getByRole('button', { name: 'Thu hồi quyền merge của bob' }).click();
    await expect(page.getByRole('button', { name: 'Cấp quyền merge cho bob' })).toBeVisible();
    await expect(page.getByText('Chủ repo · Luôn có quyền merge')).toBeVisible();
    expect(mutations).toEqual([{ defaultBranch: 'develop' }, { protectDefaultBranch: false }, { canMerge: true }, { canMerge: false }]);
    const sidebarBox = await navigation.boundingBox();
    const headingBox = await page.getByRole('heading', { name: 'Luật bảo vệ nhánh mặc định', exact: true }).boundingBox();
    expect(sidebarBox!.x + sidebarBox!.width).toBeLessThan(headingBox!.x);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/code-forge-settings-${theme}.png`, fullPage: true });
    await navigation.getByRole('button', { name: 'Mời tham gia dự án' }).click();
    await expect(page.getByRole('button', { name: 'Gửi lời mời' })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    for (const label of ['Cài đặt chung', 'Mời tham gia dự án', 'Luật bảo vệ nhánh']) {
      await navigation.getByRole('button', { name: label, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/code-forge-settings-${theme}-mobile.png`, fullPage: true });
  });
}
