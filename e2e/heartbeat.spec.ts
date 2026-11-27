import { expect, test } from '@playwright/test';
import { killMockRelay, startMockRelay } from './mock-relay';
import { shot } from './helpers';

async function startCameraWithRelay(cam: import('@playwright/test').Page, relayParam: string): Promise<string> {
  await cam.goto(`camera.html?stun=0&debug=1&relay=${relayParam}`);
  await cam.click('#start-btn');
  await cam.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await cam.click('#pair-btn');
  await expect(cam.locator('#room-code')).not.toBeHidden();
  return (await cam.locator('#room-code').textContent())!.trim();
}

async function joinRoomAndConnect(view: import('@playwright/test').Page, relayParam: string, room: string): Promise<void> {
  await view.goto(`viewer.html?stun=0&debug=1&relay=${relayParam}`);
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await expect(view.locator('#camera-list button')).toHaveCount(1);
  await view.locator('#camera-list button').first().click();
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );
}

function heartbeatAgeMs(view: import('@playwright/test').Page): Promise<number | null> {
  return view.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { getHeartbeatAgeMs?: () => number | null } }).__babycam;
    return bc?.getHeartbeatAgeMs?.() ?? null;
  });
}

test('heartbeat DataChannel : le viewer affiche « caméra hors ligne depuis Xs » si les pings cessent, puis se rétablit', async ({ browser }) => {
  const relay = await startMockRelay();
  const relayParam = encodeURIComponent(relay.url);

  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  const room = await startCameraWithRelay(cam, relayParam);
  await joinRoomAndConnect(view, relayParam, room);
  await expect(view.locator('#status')).toContainText(/Connecté|Connected/);

  // Le heartbeat tourne : l'âge du dernier ping reste faible.
  await view.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getHeartbeatAgeMs?: () => number | null } }).__babycam;
      const age = bc?.getHeartbeatAgeMs?.() ?? null;
      return age !== null && age < 5_000;
    },
    null,
    { timeout: 15_000 },
  );

  // On coupe le heartbeat côté caméra : le DataChannel et le peer restent pourtant « connected ».
  await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { stopHeartbeat?: () => void } }).__babycam;
    bc?.stopHeartbeat?.();
  });
  await expect(view.locator('#status')).toContainText(/hors ligne depuis \d+ s|offline for \d+ s/i, { timeout: 30_000 });
  await shot(view, 'P4-heartbeat-offline');

  // Le heartbeat reprend : le statut redevient « connecté ».
  await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { startHeartbeat?: () => void } }).__babycam;
    bc?.startHeartbeat?.();
  });
  await expect(view.locator('#status')).toContainText(/Connecté|Connected/, { timeout: 15_000 });
  const age = await heartbeatAgeMs(view);
  expect(age).not.toBeNull();
  expect(age!).toBeLessThan(5_000);

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
