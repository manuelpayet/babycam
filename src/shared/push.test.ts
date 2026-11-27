import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VAPID_PUBLIC_KEY,
  buildNotification,
  encodePushPayload,
  handleNotificationClick,
  handlePushEvent,
  isIOS,
  isStandalonePWA,
  parsePushPayload,
  pushSupported,
  subscribePush,
  subscriptionToPayload,
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

// ---------------------------------------------------------------------------
// Mocks de la Push API (navigator/window/Notification/PushManager stubés).
describe('push côté page (mocks Push API)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubGlobals(opts: {
    userAgent?: string;
    permission?: NotificationPermission;
    requestPermission?: () => Promise<NotificationPermission>;
    withPushManager?: boolean;
    standalone?: boolean;
  }) {
    vi.stubGlobal('navigator', {
      userAgent: opts.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      serviceWorker: {},
      ...(opts.standalone !== undefined ? { standalone: opts.standalone } : {}),
    });
    const win: Record<string, unknown> = {
      Notification: class {},
      matchMedia: (q: string) => ({ matches: q.includes('standalone') && opts.standalone === true }),
    };
    if (opts.withPushManager !== false) win.PushManager = class {};
    vi.stubGlobal('window', win);
    vi.stubGlobal('Notification', {
      permission: opts.permission ?? 'default',
      requestPermission: opts.requestPermission ?? (async () => 'granted' as NotificationPermission),
    });
  }

  const fakeSub = {
    endpoint: 'https://push.example.com/fcm/send/abc',
    toJSON: () => ({
      endpoint: 'https://push.example.com/fcm/send/abc',
      keys: { p256dh: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    }),
  } as unknown as PushSubscription;

  it('pushSupported : true avec SW + PushManager + Notification, false sinon', () => {
    stubGlobals({});
    expect(pushSupported()).toBe(true);
    stubGlobals({ withPushManager: false });
    expect(pushSupported()).toBe(false);
  });

  it('subscribePush : permission refusée → null, subscribe jamais appelé', async () => {
    stubGlobals({ permission: 'denied', requestPermission: async () => 'denied' });
    const subscribe = vi.fn();
    const reg = { pushManager: { subscribe } } as unknown as ServiceWorkerRegistration;
    expect(await subscribePush(reg)).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('subscribePush : autorisée → subscribe(userVisibleOnly + clé publique VAPID 65 octets)', async () => {
    stubGlobals({});
    const subscribe = vi.fn(async (opts: PushSubscriptionOptionsInit) => {
      void opts;
      return fakeSub;
    });
    const reg = { pushManager: { subscribe } } as unknown as ServiceWorkerRegistration;
    const sub = await subscribePush(reg);
    expect(sub).toBe(fakeSub);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const opts = subscribe.mock.calls[0][0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toHaveLength(65);
    expect(opts.applicationServerKey[0]).toBe(0x04);
    expect(base64UrlEncode(opts.applicationServerKey)).toBe(VAPID_PUBLIC_KEY);
  });

  it('subscribePush : subscribe qui lève (push service indisponible) → null', async () => {
    stubGlobals({});
    const subscribe = vi.fn(async () => {
      throw new Error('push service error');
    });
    const reg = { pushManager: { subscribe } } as unknown as ServiceWorkerRegistration;
    expect(await subscribePush(reg)).toBeNull();
  });

  it('subscriptionToPayload : extrait endpoint + keys, null si keys absentes', () => {
    expect(subscriptionToPayload(fakeSub)).toEqual({
      endpoint: 'https://push.example.com/fcm/send/abc',
      keys: { p256dh: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    });
    const noKeys = { endpoint: 'https://x', toJSON: () => ({ endpoint: 'https://x' }) } as unknown as PushSubscription;
    expect(subscriptionToPayload(noKeys)).toBeNull();
  });

  it('isIOS / isStandalonePWA : détection iPhone et mode standalone', () => {
    stubGlobals({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' });
    expect(isIOS()).toBe(true);
    stubGlobals({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120' });
    expect(isIOS()).toBe(false);
    stubGlobals({ standalone: true });
    expect(isStandalonePWA()).toBe(true);
    stubGlobals({ standalone: false });
    expect(isStandalonePWA()).toBe(false);
  });
});
