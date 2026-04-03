import { expect, test } from '@playwright/test';

const SESSION_STORAGE_KEY = 'stay-away-multiplayer-session';

test('spectator can join a started game and cannot act', async ({ page, request }) => {
  const createRes = await request.post('/api/rooms/create', { data: { name: 'Host' } });
  const created = await createRes.json() as { ok: boolean; data: { code: string; me: { sessionId: string } } };
  const code = created.data.code;
  const hostSessionId = created.data.me.sessionId;

  for (let i = 0; i < 5; i++) {
    await request.post(`/api/rooms/${code}/add-bot`, { data: { sessionId: hostSessionId } });
  }
  await request.post(`/api/rooms/${code}/start`, { data: { sessionId: hostSessionId } });

  await page.goto(`/?room=${code}`);
  await page.locator('input[placeholder]').first().fill('Watcher');
  await page.getByRole('button', { name: /создать комнату|create room/i }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /присоединиться|join room|join/i }).click();

  await expect(page.getByText(/already started/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /наблюдать за игрой|watch the game/i }).click();

  await expect(page.locator('.spectator-banner')).toBeVisible({ timeout: 20_000 });

  const rawSession = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY);
  expect(rawSession).not.toBeNull();
  const watcherSession = JSON.parse(rawSession!) as { roomCode: string; sessionId: string };

  const actionRes = await request.post(`/api/rooms/${code}/action`, {
    data: { sessionId: watcherSession.sessionId, action: { type: 'END_TURN' } },
  });
  const actionJson = await actionRes.json() as { ok: boolean; error?: string };

  expect(actionJson.ok).toBe(false);
  expect(actionJson.error).toMatch(/spectators cannot perform game actions/i);
});

test('host leaving an empty lobby removes the room', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('input[placeholder]').first().fill('SoloHost');
  await page.getByRole('button', { name: /создать комнату|create room/i }).click();

  await expect(page.locator('.lobby-screen')).toBeVisible({ timeout: 10_000 });

  const roomCode = (await page.locator('.lp-code').first().innerText()).trim();
  const rawSession = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY);
  expect(rawSession).not.toBeNull();
  const hostSession = JSON.parse(rawSession!) as { sessionId: string };

  await page.getByRole('button', { name: /выйти|покинуть|leave/i }).click();
  await expect(page.locator('.connect-screen')).toBeVisible({ timeout: 10_000 });

  const roomRes = await request.get(`/api/rooms/${roomCode}?sessionId=${hostSession.sessionId}`);
  const roomJson = await roomRes.json() as { ok: boolean; error?: string };

  expect(roomRes.status()).toBe(404);
  expect(roomJson.ok).toBe(false);
  expect(roomJson.error).toMatch(/room not found/i);
});
