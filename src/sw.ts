// Service worker de la PWA (stratégie injectManifest de vite-plugin-pwa : le point
// d'injection `self.__WB_MANIFEST` ci-dessous est remplacé à la build par le manifeste
// de précache). Trois responsabilités :
// - précache de l'app shell (cache-first pour les assets, network-first pour les pages),
//   skipWaiting + clientsClaim + nettoyage des vieux caches (màj auto, voir plan §9/§15)
// - réception des notifications push (événement `push`) et affichage de la notification
// - clic sur la notification : focus de la fenêtre viewer existante, sinon ouverture
import {
  handleNotificationClick,
  handlePushEvent,
  type ClientsLike,
  type ExtendableEventLike,
  type NotificationEventLike,
  type PushEventLike,
  type RegistrationLike,
} from './shared/push';

declare global {
  interface Window {
    __WB_MANIFEST: (string | { url: string; revision: string | null })[];
  }
}

// Le SW tourne dans un WorkerGlobalScope, pas une Window : on déclare les membres utiles.
interface SWGlobalLike {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: ClientsLike & { claim(): Promise<void> };
  registration: RegistrationLike;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: ExtendableEventLike & { request: Request; respondWith(r: Promise<Response> | Response): void }) => void): void;
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: NotificationEventLike) => void): void;
}

const sw = self as unknown as SWGlobalLike;

// Base de l'app (ex. '/babycam/') dérivée de l'URL du SW, et cache versionné par
// le contenu du manifeste de précache (chaque build a son propre cache).
const BASE_URL = new URL('.', self.location.href).href;
const BASE_PATH = new URL('.', self.location.href).pathname;
const manifest = self.__WB_MANIFEST;
const precacheUrls = manifest.map((e) => (typeof e === 'string' ? e : e.url));
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const CACHE = `babycam-precache-${hashString(JSON.stringify(manifest))}`;
const CACHE_PREFIX = 'babycam-precache-';

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(precacheUrls))
      .then(() => sw.skipWaiting())
      .catch(() => undefined),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  if (req.mode === 'navigate') {
    // Pages : network-first, repli sur le précache hors-ligne (plan §9).
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { ignoreSearch: true });
          if (hit) return hit;
          const index = await caches.match('index.html');
          return index ?? Response.error();
        }),
    );
    return;
  }
  // Assets same-origin : cache-first, et on complète le cache depuis le réseau.
  if (!url.pathname.startsWith(BASE_PATH)) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Notification push reçue (page fermée ou en arrière-plan) : on affiche l'alerte.
sw.addEventListener('push', (event) => {
  event.waitUntil(handlePushEvent(event, sw.registration, BASE_URL));
});

// Clic sur la notification : on ramène le viewer au premier plan.
sw.addEventListener('notificationclick', (event) => {
  event.waitUntil(handleNotificationClick(event.notification, sw.clients, BASE_URL));
});
