# Babycam

Babycam PWA 100 % statique : une page **caméra** (téléphone près du lit) envoie son flux vidéo/audio en **WebRTC pair-à-pair** à une page **viewer** (téléphone du parent), appairées par **QR code** (v2 : découverte par relais + code de salon). Voir [docs/plan.md](docs/plan.md) pour le plan détaillé. Captures E2E : [docs/screenshots/](docs/screenshots/).

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

## Méthodologie

Un incrément = un commit = tests verts (voir docs/plan.md §13). Les tests E2E produisent des screenshots commités dans `docs/screenshots/`.
