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

function peerState(view: import('@playwright/test').Page): Promise<string | null> {
  return view.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { getPeerState?: () => string | null } }).__babycam;
    return bc?.getPeerState?.() ?? null;
  });
}

test('coupure Wi-Fi du viewer → reconnexion automatique du flux', async ({ browser }) => {
  const relay = await startMockRelay();
  const relayParam = encodeURIComponent(relay.url);

  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  const room = await startCameraWithRelay(cam, relayParam);
  await joinRoomAndConnect(view, relayParam, room);
  expect(await peerState(view)).toBe('connected');

  await viewCtx.setOffline(true);
  await new Promise((r) => setTimeout(r, 2500));
  const stateDuringOutage = await peerState(view);
  await viewCtx.setOffline(false);

  await view.waitForFunction(
    () => {
      const bc = (window as unknown as { __babycam?: { getPeerState?: () => string | null } }).__babycam;
      return bc?.getPeerState?.() === 'connected';
    },
    null,
    { timeout: 30_000 },
  );
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await shot(view, 'I3.1-viewer-reconnected');

  console.log(`état pendant la coupure: ${stateDuringOutage}`);
  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});

test('redémarrage du relais → la caméra se reconnecte et se ré-annonce', async ({ browser }) => {
  const relay = await startMockRelay();
  const relayParam = encodeURIComponent(relay.url);

  const camCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const room = await startCameraWithRelay(cam, relayParam);

  await killMockRelay(relay);
  const relay2 = await startMockRelay(relay.port);

  const viewCtx = await browser.newContext();
  const view = await viewCtx.newPage();
  await view.goto(`viewer.html?stun=0&debug=1&relay=${encodeURIComponent(relay2.url)}`);
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await expect(view.locator('#camera-list button')).toHaveCount(1, { timeout: 30_000 });
  await shot(view, 'I3.1-camera-reannounced');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay2);
});
