import { describe, expect, it } from 'vitest';
import {
  VAPID_PUBLIC_KEY,
  buildNotification,
  encodePushPayload,
  handleNotificationClick,
  handlePushEvent,
  parsePushPayload,
  urlBase64ToUint8Array,
  type ClientsLike,
  type NotificationLike,
  type PushEventLike,
  type RegistrationLike,
} from './push';
import { base64UrlEncode } from './webpush';

describe('VAPID_PUBLIC_KEY', () => {
  it('est un point P-256 non compressé en base64url (65 octets, préfixe 0x04)', () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
    expect(base64UrlEncode(bytes)).toBe(VAPID_PUBLIC_KEY);
  });
});

describe('payload push', () => {
  it('encode/parse aller-retour', () => {
    const text = encodePushPayload('noise', -18, 123456);
    expect(parsePushPayload(text)).toEqual({ v: 1, kind: 'noise', level: -18, ts: 123456 });
  });

  it('rejette les payloads invalides', () => {
    expect(parsePushPayload('')).toBeNull();
    expect(parsePushPayload('not json')).toBeNull();
    expect(parsePushPayload('{"v":2,"kind":"noise","level":1,"ts":1}')).toBeNull();
    expect(parsePushPayload('{"v":1,"kind":"intrusion","level":1,"ts":1}')).toBeNull();
    expect(parsePushPayload('{"v":1,"kind":"noise","level":"x","ts":1}')).toBeNull();
  });
});

describe('buildNotification', () => {
  it('construit titre + options avec icône, tag, vibration et url viewer sous le base', () => {
    const { title, options } = buildNotification({ v: 1, kind: 'motion', level: 12.3, ts: 42 }, '/babycam/');
    expect(title.length).toBeGreaterThan(0);
    expect(options.body).toContain('12');
    expect(options.icon).toBe('/babycam/icons/icon-192.png');
    expect(options.tag).toBe('babycam-alert-motion');
    expect(options.vibrate).toEqual([200, 100, 200]);
    expect(options.data).toEqual({ url: '/babycam/viewer.html', kind: 'motion', ts: 42 });
  });
});

describe('handlePushEvent', () => {
  it('affiche une notification à partir du payload push', async () => {
    const shown: { title: string; options?: NotificationOptions }[] = [];
    const reg: RegistrationLike = {
      showNotification: (title, options) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    };
    const ev: PushEventLike = {
      data: { text: () => encodePushPayload('noise', -20, 7) },
      waitUntil: () => undefined,
    };
    await handlePushEvent(ev, reg, '/babycam/');
    expect(shown).toHaveLength(1);
    expect(shown[0].options?.tag).toBe('babycam-alert-noise');
    expect((shown[0].options?.data as { url: string }).url).toBe('/babycam/viewer.html');
  });

  it('ignore un push sans payload valide', async () => {
    const shown: unknown[] = [];
    const reg: RegistrationLike = { showNotification: () => Promise.resolve() };
    void reg;
    const regSpy: RegistrationLike = {
      showNotification: (title, options) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    };
    await handlePushEvent({ data: { text: () => 'garbage' }, waitUntil: () => undefined }, regSpy, '/babycam/');
    await handlePushEvent({ data: null, waitUntil: () => undefined }, regSpy, '/babycam/');
    expect(shown).toHaveLength(0);
  });
});

describe('handleNotificationClick', () => {
  function makeClients(wins: { url: string; focused: boolean; navigated: string[] }[]): ClientsLike & { opened: string[] } {
    const opened: string[] = [];
    return {
      opened,
      matchAll: () =>
        Promise.resolve(
          wins.map((w) => ({
            url: w.url,
            focus: () => {
              w.focused = true;
              return Promise.resolve();
            },
            navigate: (url: string) => {
              w.navigated.push(url);
              return Promise.resolve();
            },
          })),
        ),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      },
    };
  }

  it('focusse une fenêtre viewer existante et y navigue vers l’url de la notif', async () => {
    const win = { url: 'https://x.test/babycam/viewer.html?stun=0', focused: false, navigated: [] as string[] };
    const clients = makeClients([win]);
    let closed = false;
    const notif: NotificationLike = { close: () => (closed = true), data: { url: 'https://x.test/babycam/viewer.html' } };
    await handleNotificationClick(notif, clients, 'https://x.test/babycam/');
    expect(closed).toBe(true);
    expect(win.focused).toBe(true);
    expect(win.navigated).toEqual(['https://x.test/babycam/viewer.html']);
    expect(clients.opened).toEqual([]);
  });

  it('focusse une autre fenêtre de l’app à défaut', async () => {
    const win = { url: 'https://x.test/babycam/camera.html', focused: false, navigated: [] as string[] };
    const clients = makeClients([win]);
    await handleNotificationClick({ close: () => undefined, data: {} }, clients, 'https://x.test/babycam/');
    expect(win.focused).toBe(true);
    expect(clients.opened).toEqual([]);
  });

  it('ouvre viewer.html quand aucune fenêtre de l’app n’est ouverte', async () => {
    const clients = makeClients([]);
    await handleNotificationClick({ close: () => undefined, data: { url: 'https://x.test/babycam/viewer.html' } }, clients, 'https://x.test/babycam/');
    expect(clients.opened).toEqual(['https://x.test/babycam/viewer.html']);
  });

  it('retombe sur viewer.html si la notif n’a pas d’url', async () => {
    const clients = makeClients([]);
    await handleNotificationClick({ close: () => undefined }, clients, '/babycam/');
    expect(clients.opened).toEqual(['/babycam/viewer.html']);
  });
});
