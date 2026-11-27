// Notifications push (Web Push API) :
// - côté page viewer : souscription via le service worker + envoi de la subscription au relais
// - côté service worker (src/sw.ts) : réception de l'événement `push` et du clic sur la notification
// La clé publique VAPID est embarquée ici ; la clé privée correspondante est un secret du relais
// (voir README, `wrangler secret put VAPID_PRIVATE_KEY`). Paire générée par scripts/gen-vapid.mjs.
import { t } from './i18n';
import type { AlertKind } from './webrtc';
import { base64UrlDecode } from './webpush';

export const VAPID_PUBLIC_KEY = 'BN6ibnuYU1YDqHLFzDGKS_v0RuOovO-KMff_1HIcSfrfRZ1RGhm-K34-RCj_kWi2xTrHNCBKoNG_pXzRene33rY';

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  return base64UrlDecode(base64);
}

// ---------------------------------------------------------------------------
// Payload du push (JSON) : contrat entre le relais (relay/src/index.ts) et le SW.
export interface PushPayload {
  v: 1;
  kind: AlertKind;
  level: number;
  ts: number;
}

export function encodePushPayload(kind: AlertKind, level: number, ts: number): string {
  const p: PushPayload = { v: 1, kind, level, ts };
  return JSON.stringify(p);
}

export function parsePushPayload(text: string): PushPayload | null {
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    if (m.v !== 1) return null;
    if (m.kind !== 'noise' && m.kind !== 'motion') return null;
    if (typeof m.level !== 'number' || typeof m.ts !== 'number') return null;
    return { v: 1, kind: m.kind, level: m.level, ts: m.ts };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Construction / gestion de la notification (partagé SW + tests unitaires).
export interface PushNotificationOptions extends NotificationOptions {
  vibrate?: number[];
  data?: { url: string; kind: AlertKind; ts: number };
}

export interface NotificationSpec {
  title: string;
  options: PushNotificationOptions;
}

export function buildNotification(payload: PushPayload, baseUrl: string): NotificationSpec {
  const body = t(payload.kind === 'noise' ? 'alert.noise' : 'alert.motion');
  return {
    title: t('push.title'),
    options: {
      body: `${body} (${Math.round(payload.level)})`,
      icon: `${baseUrl}icons/icon-192.png`,
      badge: `${baseUrl}icons/icon-192.png`,
      tag: `babycam-alert-${payload.kind}`,
      data: { url: `${baseUrl}viewer.html`, kind: payload.kind, ts: payload.ts },
      vibrate: [200, 100, 200],
    },
  };
}

// Interfaces structurelles minimales : le service worker n'a pas les types DOM
// de `PushEvent`/`NotificationEvent`, mais les objets runtime sont compatibles.
export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}
export interface PushEventLike extends ExtendableEventLike {
  data?: { text(): string } | null;
}
export interface NotificationLike {
  close(): void;
  data?: unknown;
}
export interface NotificationEventLike extends ExtendableEventLike {
  notification: NotificationLike;
}
export interface ClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}
export interface ClientsLike {
  matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<ClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}
export interface RegistrationLike {
  showNotification(title: string, options?: NotificationOptions): Promise<void>;
}

export async function handlePushEvent(event: PushEventLike, registration: RegistrationLike, baseUrl: string): Promise<void> {
  const payload = parsePushPayload(event.data?.text() ?? '');
  if (!payload) return;
  const { title, options } = buildNotification(payload, baseUrl);
  await registration.showNotification(title, options);
}

export async function handleNotificationClick(notification: NotificationLike, clients: ClientsLike, baseUrl: string): Promise<void> {
  notification.close();
  const data = (notification.data ?? {}) as { url?: unknown };
  const target = typeof data.url === 'string' && data.url ? data.url : `${baseUrl}viewer.html`;
  const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const viewerWin = wins.find((w) => w.url.includes('viewer.html'));
  if (viewerWin) {
    if (viewerWin.navigate) await viewerWin.navigate(target);
    await viewerWin.focus();
    return;
  }
  const appWin = wins.find((w) => w.url.startsWith(baseUrl));
  if (appWin) {
    await appWin.focus();
    return;
  }
  await clients.openWindow(target);
}

// ---------------------------------------------------------------------------
// Côté page (viewer) : support + souscription.
export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscriptionToPayload(sub: PushSubscription): PushSubscriptionPayload | null {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
}

// Demande la permission, souscrit auprès du push service via le SW, renvoie la subscription.
export async function subscribePush(reg: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return null;
  try {
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  } catch {
    return null;
  }
}
