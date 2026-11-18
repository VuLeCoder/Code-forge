import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`personal account settings save profile, avatar and password (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('code-forge-theme', value), theme);
    const user = { id: 'owner', username: 'alice', email: 'alice@example.com', systemRole: 'USER', status: 'ACTIVE', avatarUrl: null as string | null, createdAt: '2026-11-01T00:00:00Z' };
    await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user } }));
    const requests: Record<string, string>[] = [];
    await page.route('**/api/v1/auth/account', async route => {
      const body = route.request().postDataJSON() as Record<string, string>;
      requests.push(body);
      if (body.currentPassword === 'wrong') return route.fulfill({ status: 400, json: { error: { message: 'Mật khẩu hiện tại chưa chính xác.' } } });
      if (body.username) user.username = body.username;
      if (body.email) user.email = body.email;
      if (body.avatarUrl !== undefined) user.avatarUrl = body.avatarUrl || null;
      await route.fulfill({ json: { user } });
    });
    await page.route('**/api/v1/tokens', route => route.fulfill({ json: { tokens: [] } }));
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Cài đặt cá nhân' })).toBeVisible();
    await page.getByLabel('Tên tài khoản', { exact: true }).fill('alice-new');
    await page.getByLabel('Email', { exact: true }).fill('alice-new@example.com');
    await page.locator('#profile-password').fill('wrong');
    await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Mật khẩu hiện tại chưa chính xác');
    await page.locator('#profile-password').fill('Current123');
    await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
    await expect(page.getByRole('status')).toContainText('Đã lưu thay đổi');
    await expect(page.getByRole('link', { name: 'Hồ sơ alice-new', exact: true })).toHaveAttribute('href', '/alice-new');
    await expect(page.locator('#profile-password')).toHaveValue('');
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const context = canvas.getContext('2d')!; context.fillStyle = '#4b76e8'; context.fillRect(0, 0, 8, 8);
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    await page.getByLabel('Chọn ảnh đại diện').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(page.getByRole('button', { name: 'Lưu ảnh đại diện' })).toBeEnabled();
    await page.getByRole('button', { name: 'Lưu ảnh đại diện' }).click();
    await expect(page.locator('.userAvatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    expect(requests.at(-1)?.avatarUrl).toMatch(/^data:image\/jpeg;base64,/);
    await page.getByRole('button', { name: 'Xóa ảnh', exact: true }).click();
    await page.getByRole('button', { name: 'Lưu ảnh đại diện' }).click();
    await expect(page.locator('.userAvatar img')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Mật khẩu', exact: true }).click();
    await page.locator('#old-password').fill('Current123');
    await page.locator('#new-password').fill('Changed456');
    await page.locator('#confirm-password').fill('Different789');
    await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText('Mật khẩu xác nhận chưa khớp');
    await page.locator('#confirm-password').fill('Changed456');
    await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Đã đổi mật khẩu');
    await expect(page.locator('#new-password')).toHaveValue('');
    await page.getByRole('tab', { name: 'PAT', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'PAT', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Token truy cập cá nhân' })).toBeVisible();
    await expect(page.getByLabel('Tên tài khoản', { exact: true })).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'PAT', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Hồ sơ và email', exact: true }).click();
    await expect(page.getByLabel('Chọn ảnh đại diện')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
