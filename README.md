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

## Méthodologie

Un incrément = un commit = tests verts (voir docs/plan.md §13). Les tests E2E produisent des screenshots commités dans `docs/screenshots/`.
