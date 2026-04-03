import { test, expect } from '@playwright/test';

// ── Smoke tests: connect screen → lobby ──────────────────────────────────────

test('connect screen loads and shows game logo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.connect-screen')).toBeVisible();
  await expect(page.locator('.game-logo')).toBeVisible();
});

test('create room — enter name, create, land in lobby', async ({ page }) => {
  await page.goto('/');

  await page.locator('input[placeholder]').first().fill('TestPlayer');
  await page.getByRole('button', { name: /создать комнату|create room/i }).click();

  await expect(page.locator('.lobby-screen')).toBeVisible({ timeout: 10_000 });
  // Room code is shown
  await expect(page.locator('.lp-code')).toBeVisible();
});

test('join room via URL ?room= param pre-fills code', async ({ page, request }) => {
  // Create room via API to get a code
  const res = await request.post('/api/rooms/create', { data: { name: 'Host' } });
  const json = await res.json() as { ok: boolean; data: { code: string } };
  const code = json.data.code;

  await page.goto(`/?room=${code}`);
  // The join code input should be pre-filled
  const input = page.locator('input').nth(1); // second input is room code
  await expect(input).toHaveValue(code);
});

test('lobby shows player count and add-bot button for host', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[placeholder]').first().fill('HostPlayer');
  await page.getByRole('button', { name: /создать комнату|create room/i }).click();

  await expect(page.locator('.lobby-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /добавить бота|add bot/i })).toBeVisible();
});

test('lobby: add bot increases player count', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[placeholder]').first().fill('HostPlayer');
  await page.getByRole('button', { name: /создать комнату|create room/i }).click();

  await expect(page.locator('.lobby-screen')).toBeVisible({ timeout: 10_000 });

  const addBot = page.getByRole('button', { name: /добавить бота|add bot/i });
  await addBot.click();
  await addBot.click();
  await addBot.click();

  // Should now have 4 rows (1 host + 3 bots)
  await expect(page.locator('.lp-row:not(.empty)')).toHaveCount(4, { timeout: 5_000 });
});

test('start game button enabled with ≥4 players', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[placeholder]').first().fill('HostPlayer');
  await page.getByRole('button', { name: /создать комнату|create room/i }).click();

  await expect(page.locator('.lobby-screen')).toBeVisible({ timeout: 10_000 });

  const addBot = page.getByRole('button', { name: /добавить бота|add bot/i });
  for (let i = 0; i < 3; i++) await addBot.click();

  const startBtn = page.locator('.lp-btn-start');
  await expect(startBtn).toBeEnabled({ timeout: 5_000 });
});

test('game screen appears after start', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[placeholder]').first().fill('HostPlayer');
  await page.getByRole('button', { name: /создать комнату|create room/i }).click();

  await expect(page.locator('.lobby-screen')).toBeVisible({ timeout: 10_000 });

  const addBot = page.getByRole('button', { name: /добавить бота|add bot/i });
  for (let i = 0; i < 5; i++) await addBot.click(); // 1 + 5 = 6 players

  await page.locator('.lp-btn-start').click();

  // Game screen loads (lazy — give it time)
  await expect(page.locator('.game-screen, .game-root, [class*="game"]').first()).toBeVisible({ timeout: 20_000 });
});
