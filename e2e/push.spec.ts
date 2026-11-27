import { expect, test } from '@playwright/test';
import { pairViaRoom, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

// Chromium headless n'a pas de push service réel : on remplace PushManager.subscribe
// par une fausse subscription (le relais mock n'envoie de toute façon pas de vrai push).
const PUSH_STUB = `
  window.__fakeSub = {
    endpoint: 'https://push.example.com/fcm/send/test-sub-1',
    expirationTime: null,
    getKey: () => new Uint8Array(65),
    toJSON() {
      return {
        endpoint: this.endpoint,
        expirationTime: null,
        keys: { p256dh: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      };
    },
    unsubscribe: async () => true,
  };
  PushManager.prototype.subscribe = async (opts) => {
    window.__subscribeOpts = opts;
    return window.__fakeSub;
  };
`;

test('viewer : la souscription push est envoyée au relais et persistée', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext({ permissions: ['notifications'] });
  await viewCtx.addInitScript(PUSH_STUB);
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await pairViaRoom(cam, view, relay.url);

  await view.click('#push-btn');
  await expect(view.locator('#push-status')).toContainText(/activées|enabled/);

  // applicationServerKey = clé publique VAPID (point P-256 de 65 octets)
  const opts = await view.evaluate(
    () => (window as unknown as { __subscribeOpts?: { applicationServerKey?: Uint8Array; userVisibleOnly?: boolean } }).__subscribeOpts,
  );
  expect(opts?.userVisibleOnly).toBe(true);
  expect(opts?.applicationServerKey).toHaveLength(65);
  expect(opts?.applicationServerKey?.[0]).toBe(0x04);

  // le relais mock a reçu la subscription et a acquitté
  await expect.poll(() => relay.pushSubs.size).toBe(1);
  expect([...relay.pushSubs.keys()][0]).toBe('https://push.example.com/fcm/send/test-sub-1');
  await expect.poll(() => relay.pushAcks).toBe(1);

  // la subscription est persistée en localStorage
  const stored = await view.evaluate(
    () => (window as unknown as { __babycam?: { getPushSub?: () => { endpoint: string } | null } }).__babycam?.getPushSub?.(),
  );
  expect(stored?.endpoint).toBe('https://push.example.com/fcm/send/test-sub-1');
  await shot(view, 'I5.1-viewer-push-enabled');

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});

test('caméra : une alerte part aussi vers le relais (push vers les viewers abonnés)', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext({ permissions: ['notifications'] });
  await viewCtx.addInitScript(PUSH_STUB);
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  await pairViaRoom(cam, view, relay.url);
  await view.click('#push-btn');
  await expect.poll(() => relay.pushSubs.size).toBe(1);

  // alerte déclenchée côté caméra (voie réelle : onAlert)
  await cam.evaluate(() => {
    const bc = (window as unknown as { __babycam?: { triggerAlert?: (kind: string, level: number) => void } }).__babycam;
    bc?.triggerAlert?.('noise', -18);
  });

  // le relais a reçu l'alerte, avec au moins 1 abonné push ciblé
  await expect.poll(() => relay.alerts.some((a) => a.kind === 'noise' && a.level === -18)).toBe(true);
  expect(relay.pushTargets).toBeGreaterThanOrEqual(1);

  // et le flux DataChannel P2P continue de fonctionner (bannière côté viewer)
  await expect(view.locator('#alert-banner')).toBeVisible();
  await expect(view.locator('#alert-banner')).toContainText(/bruit|noise/i);

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});

test('service worker : push → showNotification, clic → openWindow(viewer.html)', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['notifications'] });
  const page = await ctx.newPage();
  const swPromise = ctx.waitForEvent('serviceworker');
  await page.goto('viewer.html?stun=0&debug=1');
  const sw = await swPromise;
  await page.evaluate(() => navigator.serviceWorker.ready);
  await shot(page, 'I5.1-viewer-sw');

  // Événement `push` synthétique dans le SW (showNotification espionné).
  await sw.evaluate(() => {
    const g = self as unknown as Record<string, unknown>;
    g.__shown = [];
    const reg = g.registration as Record<string, unknown>;
    reg.showNotification = (title: string, options: unknown) => {
      (g.__shown as unknown[]).push({ title, options });
      return Promise.resolve();
    };
    const ev = new Event('push');
    Object.defineProperty(ev, 'data', {
      value: { text: () => JSON.stringify({ v: 1, kind: 'noise', level: -18, ts: 42 }) },
    });
    Object.defineProperty(ev, 'waitUntil', { value: (p: Promise<unknown>) => (g.__waited = p) });
    self.dispatchEvent(ev);
  });
  await sw.evaluate(() => (self as unknown as Record<string, unknown>).__waited);
  const shown = (await sw.evaluate(
    () => (self as unknown as Record<string, unknown>).__shown as { title: string; options: Record<string, unknown> }[],
  )) ?? [];
  expect(shown).toHaveLength(1);
  expect(shown[0].title).toMatch(/alerte|alert/i);
  expect(String(shown[0].options.body)).toMatch(/bruit|noise/i);
  expect(shown[0].options.tag).toBe('babycam-alert-noise');
  expect(shown[0].options.vibrate).toEqual([200, 100, 200]);
  expect(shown[0].options.icon).toMatch(/icons\/icon-192\.png$/);
  expect(shown[0].options.data).toMatchObject({ url: expect.stringContaining('viewer.html'), kind: 'noise', ts: 42 });

  // Clic sur la notification (aucune fenêtre ouverte → openWindow viewer.html).
  await sw.evaluate(() => {
    const g = self as unknown as Record<string, unknown>;
    g.__opened = [];
    g.__closed = false;
    const clients = g.clients as Record<string, unknown>;
    clients.openWindow = (url: string) => {
      (g.__opened as string[]).push(url);
      return Promise.resolve(null);
    };
    clients.matchAll = () => Promise.resolve([]);
    const notif = {
      close: () => (g.__closed = true),
      data: { url: 'http://localhost:4173/babycam/viewer.html' },
    };
    const ev = new Event('notificationclick');
    Object.defineProperty(ev, 'notification', { value: notif });
    Object.defineProperty(ev, 'waitUntil', { value: (p: Promise<unknown>) => (g.__waited2 = p) });
    self.dispatchEvent(ev);
  });
  await sw.evaluate(() => (self as unknown as Record<string, unknown>).__waited2);
  const opened = (await sw.evaluate(() => (self as unknown as Record<string, unknown>).__opened as string[])) ?? [];
  const closed = await sw.evaluate(() => (self as unknown as Record<string, unknown>).__closed);
  expect(closed).toBe(true);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain('viewer.html');

  await ctx.close();
});
