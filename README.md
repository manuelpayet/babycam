# Babycam

Babycam PWA 100 % statique : une page **caméra** (téléphone près du lit) envoie son flux vidéo/audio en **WebRTC pair-à-pair** à une page **viewer** (téléphone du parent), appairées par **code de salon** via le relais (le QR affiché ne contient que ce code). Voir [docs/plan.md](docs/plan.md) pour le plan détaillé. Captures E2E : [docs/screenshots/](docs/screenshots/).

## URL

Déployé sur GitHub Pages : `https://manuelpayet.github.io/babycam/` (HTTPS requis pour `getUserMedia`).

## Prérequis déploiement (une fois)

Dans les réglages du dépôt GitHub : **Settings → Pages → Source → GitHub Actions**. Chaque push sur `main` déploie `dist/` (workflow `.github/workflows/deploy.yml`).

## Développement local

```bash
npm ci
npm run dev        # http://localhost:5173/babycam/
npm test           # tests unitaires (vitest)
npm run test:e2e   # tests E2E (Playwright, build + preview auto)
npm run lint && npm run typecheck && npm run build
```

## Relais WebSocket (appairage par code de salon)

Un petit relais Cloudflare Worker (`relay/`, Durable Object `RoomDO`) ne sert qu'à l'échange de signalisation (SDP) — le flux média reste 100 % pair-à-pair en WebRTC. Déployer une fois :

```bash
cd relay
npm install
npx wrangler login
npx wrangler deploy   # → https://babycam-relay.<sous-domaine>.workers.dev (à relancer après chaque modif de relay/)
npx wrangler tail     # logs en temps réel
```

Le salon vit dans un Durable Object : son état est stocké dans les attachments des WebSockets (`serializeAttachment`), donc il survit à l'éviction de l'objet par Cloudflare.

L'URL déployée est renseignée dans `src/shared/relay.ts` (`DEFAULT_RELAY_URL` = `wss://babycam-relay.veille-cron.workers.dev`). Le bouton « Appairer » de la caméra (page dédiée `#/pair`) crée un salon et affiche un **petit QR de salon** (`BCAM1/R/CODE`) : le SDP passe par le relais, jamais par le QR. `?relay=<wss://…>` remplace le relais dans l'URL (les tests E2E utilisent un relais mock local).

## Notifications push (alertes même page viewer fermée)

Hors périmètre « 100 % statique » : le relais sert aussi à pousser des **Web Push** (RFC 8030/8291/8292) aux viewers abonnés d'un salon.

- **Viewer** : bouton « Activer les notifications » → permission + `pushManager.subscribe()` (clé publique VAPID embarquée dans `src/shared/push.ts`) → la subscription est envoyée au relais sur le WebSocket du salon (`{type:'push', sub}`) et persistée en `localStorage` (renvoyée à chaque connexion, gérée aussi via `pushsubscriptionchange`).
- **Relais** (`relay/src/index.ts`) : stocke les subscriptions dans le **stockage SQLite du Durable Object** (elles survivent à l'hibernation et à la fermeture des sockets), et sur `{type:'alert'}` envoyé par la caméra, envoie un push chiffré `aes128gcm` + en-tête VAPID ES256 à chaque subscription (404/410 → subscription supprimée). Le chiffrement/jeton est implémenté en WebCrypto pur dans `src/shared/webpush.ts` (validé octet pour octet contre le vecteur de test RFC 8291).
- **Service worker** (`src/sw.ts`, stratégie `injectManifest`) : précache de l'app shell + `push` → `showNotification` (icône, tag, vibration, `data.url = viewer.html`) + `notificationclick` → focus de la fenêtre viewer existante ou `openWindow`.
- **Caméra** : chaque alerte (bruit/mouvement) part à la fois sur le DataChannel P2P (viewers connectés) et vers le relais (`relay.sendAlert`) pour les viewers abonnés dont la page est fermée.

Déploiement (une fois) :

```bash
cd relay
npx wrangler secret put VAPID_PRIVATE_KEY   # clé privée de la paire — JAMAIS dans le code
npx wrangler deploy                          # à relancer après chaque modif de relay/
```

Convention VAPID : seule la clé **publique** est dans le code (`VAPID_PUBLIC_KEY` dans `src/shared/push.ts` et `relay/wrangler.toml`) ; la clé **privée** n'existe que comme secret du worker (`wrangler secret put VAPID_PRIVATE_KEY`) et en local dans `relay/.dev.vars` (gitignoré). `VAPID_SUBJECT` = `mailto:babycam@veille-cron.workers.dev` (dans `relay/wrangler.toml` [vars]). Pour (re)générer une paire : `npm run vapid` (`scripts/gen-vapid.mjs`) affiche la paire + les commandes, puis mettre à jour la clé publique dans les deux fichiers, poser la privée en secret, et redéployer le relais.

iOS (best effort) : Safari iOS ≥ 16.4 pousse uniquement pour une PWA installée (bouton Partager → « Sur l'écran d'accueil ») ; sinon le viewer affiche un message clair et les alertes restent celles de la page ouverte (DataChannel).

## Méthodologie

Un incrément = un commit = tests verts (voir docs/plan.md §13). Les tests E2E produisent des screenshots commités dans `docs/screenshots/`.
