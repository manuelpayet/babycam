# Plan détaillé — Babycam (PWA statique)

Statut : brouillon à valider. Aucun code n'est écrit à ce stade.

## 1. Vision

Babycam est une application web installable (PWA) déployée sous forme de **site 100 % statique** sur GitHub Pages. Elle comporte deux pages servies par le même site :

- **Page Caméra** (`/camera`) — posée sur le téléphone près du lit : capte la vidéo + le micro, garde l'écran allumé (Wake Lock), appaire des viewers par QR code (v1) ou par découverte via code de salon (v2), et (v2) détecte le bruit et le mouvement.
- **Page Viewer** (`/viewer`) — sur le téléphone du parent : scanne un QR code pour s'appairer à une caméra, reçoit le flux vidéo/audio en direct et les alertes (bruit / mouvement).

Page d'accueil (`/`) : choix « Je surveille » (caméra) ou « Je regarde » (viewer), plus accès aux réglages et à la langue.

## 2. Contrainte d'architecture : pourquoi WebRTC, pas un « serveur statique »

- `getUserMedia()` ne donne accès à la caméra que **localement**, dans la page qui la demande. Une page statique ne peut donc pas, à elle seule, « servir » un flux live à un autre appareil.
- Solution retenue : **WebRTC pair-à-pair**. Seule la *signalisation* (échange de l'offre/réponse SDP) transite hors bande — ici **manuellement par QR code** (avec copier-coller en secours). Le flux média passe ensuite directement entre les deux appareils via un serveur STUN public. **Zéro backend**, hébergement statique suffisant.
- Conséquence pour le multi-viewers : architecture en **mesh** — la page caméra maintient une `RTCPeerConnection` par viewer appairé (N viewers = N QR d'appairage, un à la fois). Toujours sans serveur.
- En **v2** s'ajoute une seconde méthode d'appairage : la **découverte** des caméras disponibles via un mini relais de signalisation + code de salon (§5.4). La v1 reste 100 % zéro serveur (QR uniquement).

## 3. Décisions prises (récapitulatif des réponses)

| Sujet | Décision |
|---|---|
| Transport du flux | WebRTC P2P + appairage QR, zéro serveur |
| Périmètre v1 | Page caméra + page viewer + appairage QR + flux vidéo **et audio** |
| Audio | Unidirectionnel caméra → viewer (pas de talkie-walkie) |
| Scénario d'appareils | Deux appareils distincts sur le même réseau local |
| Sécurité de l'appairage | QR seul (le QR est le secret), pas de PIN — usage réseau local uniquement |
| Seconde méthode d'appairage | Découverte par relais + code de salon, en **v2** ; le QR reste le mode v1 et le secours permanent |
| Hébergement | GitHub Pages (HTTPS requis pour `getUserMedia`, fourni par Pages) |
| Navigateurs cibles | Android + Chrome et iPhone + Safari, iOS en best effort (pas de matériel Apple pour tester) |
| Viewers simultanés | Plusieurs parents en parallèle (mesh côté caméra) |
| Canal d'alerte | Alertes locales sur le viewer (page ouverte) d'abord ; push en v2 (hors 100 % statique) |
| Seuil de bruit | Slider réglable dans l'UI, persisté en `localStorage` |
| Zone de mouvement | Toute l'image + réglage de sensibilité |
| Action sur alerte | Alerte sur le viewer (son + vibration + bannière) **et** réveil/signal sur l'écran caméra |
| Stack | Vite + vanilla TypeScript (pas de framework) |
| Écran caméra | Wake Lock actif pendant la surveillance |
| Langues de l'UI | Français + anglais (i18n) |
| Livrable immédiat | Ce plan détaillé, sans code |
| Méthodologie | Incréments testés (unitaires vitest + E2E Playwright quand pertinent), **un commit par incrément**, CI verte à chaque commit (§13-§14) |

## 4. Architecture générale

- **Build** : Vite en mode multi-page (MPA) avec 3 entrées HTML : `index.html`, `camera.html`, `viewer.html`. Build vanilla TS, aucune dépendance runtime de framework.
- **Base path** : `/babycam/` (site projet GitHub Pages, pas site utilisateur) → `base: '/babycam/'` dans `vite.config.ts`.
- **PWA** : `manifest.webmanifest` + service worker générés via `vite-plugin-pwa` (precache de l'app shell, `registerType: 'autoUpdate'`). L'app shell doit se charger offline ; le flux live, évidemment, non.
- **i18n** : dictionnaires `fr` / `en`, détection `navigator.language`, sélecteur manuel, persistance `localStorage`.
- **Communication média** : WebRTC (`RTCPeerConnection`, tracks vidéo + audio). STUN public (`stun:stun.l.google.com:19302`). Pas de TURN en v1 (coût ; suffisant pour la plupart des Wi-Fi domestiques).
- **Signalisation** : manuelle par QR code (voir §5).
- **Alertes** : `RTCDataChannel` caméra → viewers (voir §8.3).

## 5. Protocole d'appairage (v1 : QR code, mode par défaut ; v2 : découverte par relais, §5.4)

### 5.1 Flux nominal (1 caméra → 1 viewer)

```
Caméra                          Viewer
  | -- créer PC, ajouter tracks, createOffer, attendre ICE gathering complete
  | -- encoder l'offre en QR (plusieurs QR si besoin) --> afficher
  |                                                        | -- scanner les QR (ou coller)
  |                                                        | -- setRemote(offer), createAnswer, attendre ICE
  | <-- encoder la réponse en QR, l'afficher ------------- |
  | -- scanner la réponse (ou coller) --> setRemote(answer)
  | ===== connexion WebRTC établie, flux A/V direct =====> |
  | <-- DataChannel "hello" {name} du viewer ------------- |
```

### 5.2 Format du payload QR

- JSON `{ "v": 1, "t": "offer" | "answer", "sdp": "..." }` → compression deflate (`pako`) → `base64url` → découpage en chunks.
- Chaque chunk est un QR préfixé : `BCAM1/<index>/<total>/<chunk>`. La caméra affiche les QR en séquence (carrousel « QR 2/5 ») ; le viewer les scanne dans l'ordre et réassemble.
- **Pourquoi le chunking** : un SDP audio+vidéo fait plusieurs kilo-octets, supérieur à la capacité d'un QR (max ~2,9 Ko). Compression + multi-QR = robuste.
- Attendre `icegatheringstate === 'complete'` (avec timeout ~10 s) pour que le SDP contienne tous les candidats : un seul payload, pas de trickle ICE à transporter.
- **Secours** : copier-coller manuel (textarea) si la caméra du viewer ne peut pas scanner.

### 5.3 Machine à états (côté caméra, par viewer)

`idle → offering (QR affiché) → awaiting-answer → connected → disconnected/failed`

- Bouton « Révoquer » par viewer : ferme la PC, retire le viewer de la liste.
- Sur `iceconnectionstate = failed/disconnected` : tentative d'ICE restart automatique, sinon affichage d'un état d'erreur clair et bouton « réappairer » (nouveau QR).
- Multi-viewers : répéter le flux §5.1 pour chaque nouveau viewer ; la caméra garde une `Map<viewerId, { pc, dc, name }>`.

### 5.4 Seconde méthode d'appairage (v2) : découverte par relais + code de salon

Objectif : une UX « découverte » — le viewer voit les caméras appairables et clique — en complément du QR. Le mDNS/Bonjour pur étant impossible depuis un navigateur (§2), on passe par un relais de signalisation.

- **Relais** : tout petit Worker Cloudflare (WebSocket + Durable Object, tier gratuit, hibernation WebSocket → coût ~0) qui ne transporte **que** la présence et la signalisation SDP — jamais le média, qui reste P2P WebRTC. Code dans `relay/`, déployé via `wrangler` sur un compte Cloudflare gratuit. Côté client web : WebSocket natif, aucune dépendance.
- **Salon** : code de 6 caractères alphanumériques généré par la caméra ; c'est le secret (équivalent au QR). La caméra publie sa présence dans le salon : `{ name: "Chambre de Léa", ts, viewers: n }`, avec heartbeat.
- **Flux** : le viewer saisit le code du salon (ou scanne un QR ne contenant que ce code, beaucoup plus léger qu'un SDP) → se connecte au relais → liste les caméras présentes dans ce salon → en sélectionne une → échange offre/réponse SDP + candidats ICE via le relais (trickle ICE OK ici, contrairement au QR) → connexion P2P établie, puis DataChannel comme en §5.1-5.3.
- **Sécurité** : le code de salon est le seul secret ; optionnellement, signalisation chiffrée de bout en bout (AES-GCM via WebCrypto, clé dérivée du code) pour que le relais ne voie que du chiffré. Révocation d'un viewer possible côté caméra.
- **Portée** : le relais passant par internet, l'appairage fonctionne aussi hors du Wi-Fi local — à arbitrer (le code de salon fait alors office de seul garde-fou).
- Le **QR reste disponible** dans toutes les versions comme mode zéro-serveur / secours.

## 6. Page Caméra — fonctionnalités

- `getUserMedia({ video: { facingMode: 'environment' }, audio: { echoCancellation: true, noiseSuppression: true } })` ; aperçu local `<video muted autoplay playsinline>`.
- **Wake Lock** : `navigator.wakeLock.request('screen')` au démarrage, re-demandé sur `visibilitychange` ; indicateur visuel « écran maintenu allumé » (best effort iOS ≥ 16.4).
- Contrôles : démarrer/arrêter, bascule caméra avant/arrière (`enumerateDevices`), torche (`track.applyConstraints({ advanced: [{ torch: true }] })` si supporté), qualité (résolution cible).
- Appairage : QR courant + file d'attente, liste des viewers connectés (nom envoyé par le viewer), révocation individuelle.
- v2 : modules de détection (§8) + réglages (seuils persistés).

## 7. Page Viewer — fonctionnalités

- Scan des QR d'offre (caméra du téléphone via lib de scan) ou saisie manuelle → génère la réponse → affiche le QR de réponse à montrer à la caméra.
- `<video autoplay playsinline>` recevant le `remoteStream` ; **audio non muté**, mais iOS exige un geste utilisateur pour l'autoplay sonore → bouton « Activer le son » (unmute après tap).
- DataChannel « alerts » : à la réception d'une alerte → son d'alerte (WebAudio), `navigator.vibrate([200, 100, 200])`, bannière « Bruit détecté » / « Mouvement détecté » + entrée horodatée dans un historique.
- Contrôles : plein écran, son on/off, re-scan pour réappairer, déconnexion.
- Optionnel et bon marché : jauge de niveau sonore live envoyée par la caméra via DataChannel (toutes les ~500 ms).

## 8. Détection et alertes (v2 — « à terme »)

### 8.1 Détection de bruit (côté caméra)

- Web Audio API : `MediaStreamAudioSourceNode` → `AnalyserNode` (`fftSize: 2048`), lecture `getByteTimeDomainData` toutes les ~150 ms → calcul du **RMS** → niveau en dBFS.
- **Seuil** : slider 0–100 dans l'UI, persisté `localStorage`, mappé sur une plage de dBFS.
- Anti-faux-positifs : moyenne glissante (~300 ms), déclenchement si niveau > seuil pendant ≥ 400 ms consécutifs, puis **cooldown** de ~5 s.

### 8.2 Détection de mouvement (côté caméra)

- Canvas caché basse résolution (ex. 160 px de large), `drawImage(video)` toutes les ~200 ms, `getImageData`, comparaison à la frame précédente : différence de luminance par pixel, comptage des pixels dont la diff > ~25 → **ratio de pixels changés**.
- **Toute l'image** (décision), avec slider de **sensibilité** mappé sur le ratio seuil ; cooldown ~2 s entre deux événements. Throttling pour limiter le CPU.

### 8.3 Propagation des alertes et actions

- Événement détecté côté caméra → `dataChannel.send(JSON.stringify({ type: 'alert', kind: 'noise' | 'motion', level, ts }))` vers **tous** les viewers connectés.
- Côté viewer : son + vibration + bannière + historique (voir §7).
- Côté caméra (« réveil écran caméra ») : re-acquisition du Wake Lock, flash visuel de l'écran et bip local si l'écran était éteint/atténué.

## 9. PWA : manifest, service worker, icônes

- `manifest.webmanifest` : nom « Babycam », `display: 'standalone'`, `start_url: '/babycam/'`, orientation portrait, couleurs de thème, icônes 192/512 (dont variantes maskable).
- Icônes : placeholder SVG fourni, PNG 192/512 générés par un petit script (à fournir au moment du code) — point ouvert, icônes finales à remplacer.
- Service worker : précache des assets buildés, stratégie `NetworkFirst` pour les pages, app shell disponible offline.

## 10. Déploiement sur GitHub Pages

- Workflow `.github/workflows/deploy.yml` : sur push sur `main`, `npm ci` → `npm run build` → déploiement via les actions officielles (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`).
- URL cible : `https://manuelpayet.github.io/babycam/` (d'où le `base: '/babycam/'`).
- Prérequis : activer GitHub Pages (source « GitHub Actions ») dans les réglages du dépôt — à faire une fois côté GitHub.
- Le relais v2 se déploie à part : `cd relay && wrangler deploy` (compte Cloudflare gratuit).

## 11. Structure du projet proposée

```
babycam/
├── index.html                  # accueil : choix caméra / viewer
├── camera.html
├── viewer.html
├── public/
│   └── icons/                  # 192, 512, maskable, apple-touch-icon
├── src/
│   ├── pages/
│   │   ├── home/main.ts
│   │   ├── camera/main.ts
│   │   └── viewer/main.ts
│   └── shared/
│       ├── webrtc.ts           # PeerManager : PC, offre/réponse, ICE, mesh multi-viewers
│       ├── signaling.ts        # encode/décode SDP pour QR (pako + base64url + chunking)
│       ├── relay.ts            # v2 : client WebSocket du relais (présence + signalisation)
│       ├── qr.ts               # génération QR + scan caméra
│       ├── detection/noise.ts  # AnalyserNode, RMS, seuil, hystérésis, cooldown
│       ├── detection/motion.ts # frame diff sur canvas basse résolution
│       ├── alerts.ts           # DataChannel alertes, son, vibration, bannière, historique
│       ├── wakelock.ts
│       ├── i18n.ts             # fr / en
│       └── ui.ts               # composants communs (boutons, bannière, slider)
├── relay/                      # v2 : mini relais WebSocket (Cloudflare Worker + Durable Object)
│   ├── src/index.ts
│   └── wrangler.toml
├── playwright.config.ts
├── e2e/                        # tests E2E Playwright (caméra/viewer, appairage, alertes, PWA)
├── vite.config.ts              # MPA, base '/babycam/', vite-plugin-pwa
├── package.json
├── .github/workflows/ci.yml    # lint + vitest + playwright + build, à chaque push/PR
├── .github/workflows/deploy.yml
└── docs/plan.md                # ce document
```

## 12. Dépendances (build/dev uniquement, rien de framework)

- `vite`, `typescript`, `vite-plugin-pwa`, `vitest`, `eslint`
- `qrcode` (génération des QR), `pako` (compression du payload), `html5-qrcode` ou `@zxing/browser` (scan QR par la caméra)
- E2E : `@playwright/test` (+ `jsqr` pour décoder les QR affichés dans les tests)
- v2 : aucun ajout client (WebSocket natif pour `relay.ts`) ; le relais vit à part dans `relay/` (Cloudflare Worker, déployé avec `wrangler`)

## 13. Méthodologie : incréments testés, un commit par incrément

Chaque incrément est petit, testé (unitaires vitest, plus E2E Playwright quand pertinent — §14), et livré par **un seul commit** sur la branche de travail. Règle : un commit n'est poussé que si la CI est verte (lint + tests unitaires + E2E + build). Les PR sont des regroupements d'incréments. **Visuels** : les tests E2E produisent des captures d'écran dans `docs/screenshots/`, commitées avec l'incrément pour voir l'interface évoluer.

### Phase 0 — squelette
- I0.1 : init projet Vite + TS, `base: '/babycam/'`, 3 pages vides, build OK → commit (CI lint/build).
- I0.2 : PWA (manifest + service worker via `vite-plugin-pwa`, icônes placeholder) ; E2E Playwright : manifest servi, SW enregistré, app shell offline → commit.
- I0.3 : i18n FR/EN + sélecteur de langue + persistance `localStorage` ; tests unitaires i18n → commit.
- I0.4 : workflow de déploiement GitHub Pages ; vérification HTTPS + base path en ligne → commit.

### Phase 1 — v1 (flux A/V + appairage QR)
- I1.1 : page caméra : `getUserMedia` + aperçu + start/stop + sélection caméra ; E2E Playwright avec médias factices Chromium (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`) → commit.
- I1.2 : Wake Lock + torche (best effort) ; tests unitaires (mocks) → commit.
- I1.3 : signalisation QR : encode/décode (pako + base64url + chunking multi-QR) ; tests unitaires round-trip → commit.
- I1.4 : génération/affichage des QR (carrousel « QR i/n ») ; E2E : le QR rendu est décodé avec `jsqr` dans le test → commit.
- I1.5 : scan QR côté viewer + saisie copier-coller (secours) → commit.
- I1.6 : `PeerManager` WebRTC + appairage QR 1→1 complet ; E2E Playwright : deux contextes (caméra + viewer), flux A/V vérifié de bout en bout → commit.
- I1.7 : multi-viewers en mesh + révocation + reconnexion ; E2E : 1 caméra → 2 viewers → commit.
- I1.8 : page viewer : rendu du flux, son après geste utilisateur, plein écran → commit.

### Phase 2 — v2
- I2.1 : détection de bruit (RMS via AnalyserNode, slider de seuil persisté, hystérésis, cooldown) ; tests unitaires sur buffers synthétiques ; E2E avec source audio factice → commit.
- I2.2 : détection de mouvement (frame diff sur canvas basse résolution, sensibilité réglable) ; tests unitaires sur `ImageData` synthétiques → commit.
- I2.3 : alertes de bout en bout (DataChannel : son/vibration/bannière/historique côté viewer, signal + wake lock côté caméra) ; E2E Playwright : alerte injectée → bannière assertée → commit.
- I2.4 : seconde méthode d'appairage — relais + code de salon (`relay/` Worker + `relay.ts` client : présence, échange SDP) ; tests unitaires + E2E avec relais local (`wrangler dev` ou mock WebSocket dans le test) → commit.

### Phase 3 — optionnel
- I3.1 : **reconnexion automatique** — `restartIce()` + ré-offre côté caméra (via relais auto, ou QR à re-scanner), reconnexion WS du relais avec backoff + re-join + ré-annonce de présence, re-request viewer sur `disconnected`/`failed` ; E2E : coupure réseau simulée (`setOffline`) et redémarrage du relais.
- I3.2 : **appairage QR simplifié (réseau local)** — mode QR sans STUN (`iceServers: []`) → SDP compact → **un seul QR** offre et réponse (chunk 4200, carrousel en fallback), la caméra **scanne la réponse avec la caméra frontale** (plus de copier-coller), copier-coller en secours ; E2E : un seul chunk + QR décodé identique au payload.
- I3.3 : **QR = code de salon (option A)** — si un relais est configuré (`?relay=` ou `DEFAULT_RELAY_URL`), le QR d'appairage ne contient que `BCAM1/R/CODE` (QR minuscule v1-2) et le SDP passe par le relais ; sinon fallback QR SDP (I3.2) **allégé au maximum** (`mungeSdpAggressive` : un seul codec vidéo choisi + opus seul en audio, extmap supprimés → QR ~v15-17). **Liste déroulante codec vidéo** (défaut = premier codec du navigateur, persisté) ; E2E : QR salon décodé + appairage complet via relais, persistance du codec, contenu du QR sans relais = 1 seul PT vidéo + opus + pas d'extmap.
- I3.4 : **QR encore plus petit + PWA auto-mise à jour** — slimming SDP supplémentaire (`slimSdpForQr` : lignes `a=ssrc`/`a=msid`/`a=rid:`/`a=simulcast` supprimées, seuls les candidats `udp` + `typ host` conservés) appliqué à l'offre **et** à la réponse QR, QR affiché plus grand (340px) ; service worker : `skipWaiting` + `clientsClaim`, enregistrement manuel avec `updateViaCache: 'none'` + `registration.update()` à chaque chargement + rechargement auto quand un nouveau SW prend le contrôle (un vieux SW en cache ne bloque plus la mise à jour) ; badge `v<hash git>` en bas de chaque page pour vérifier la version déployée ; tests unitaires (slim SDP, `videoMimeFromSdp`) + E2E (payload < 1000 car., 1 seul QR décodé == payload, appairage complet avec SDP allégé, badge) → commit.
- Notifications push (hors 100 % statique), enregistrement d'extraits sur alerte, audio bidirectionnel, zone d'intérêt pour le mouvement.

## 14. Tests

- **Unitaires (vitest)** : `*.test.ts` colocalisés, exécutés en CI à chaque commit. Couvrent : round-trip encode/décode de la signalisation (chunking multi-QR inclus), calcul RMS/bruit sur buffers synthétiques, diff d'images sur `ImageData` synthétiques, i18n (fallback de langue), machine à états d'appairage, Wake Lock (mocks).
- **E2E (Playwright)** : `playwright.config.ts` + `e2e/`, exécutés en CI (Chromium headless uniquement ; iOS reste best effort, test manuel). Points clés :
  - médias factices Chromium (`--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`) pour tester la page caméra sans matériel ;
  - **deux contextes Playwright = deux « appareils »** : appairage QR de bout en bout (scan simulé en décodant le QR affiché avec `jsqr`, ou via le secours copier-coller), flux A/V vérifié, multi-viewers (1 caméra → 2 viewers), alertes (alerte injectée → bannière + historique assertés côté viewer) ;
  - PWA : manifest servi, service worker enregistré, app shell disponible offline ;
  - **captures d'écran** : chaque scénario E2E sauvegarde des screenshots dans `docs/screenshots/` (commitées avec l'incrément) pour visualiser l'évolution de l'UI.
- **Manuels (checklist)** : deux vrais téléphones sur le même Wi-Fi — appairage QR, flux vidéo+audio, alerte bruit (claquement de mains), alerte mouvement, wake lock, révocation, multi-viewers, installation PWA, iOS Safari (best effort).
- **CI** : `.github/workflows/ci.yml` — lint + `vitest` + `playwright test` + `vite build` à chaque push/PR ; déploiement Pages séparé sur `main` (§10). Règle : **1 incrément = 1 commit**, poussé uniquement si la CI est verte.

## 15. Risques et mitigations

| Risque | Mitigation |
|---|---|
| SDP trop gros pour un QR | Compression + QR chunkés en séquence + copier-coller en secours |
| Autoplay audio bloqué (iOS) | Bouton « Activer le son » après geste utilisateur |
| iOS Safari : quirks PWA/WebRTC/Wake Lock | Cible best effort, test manuel si matériel dispo ; messages d'erreur explicites |
| NAT symétrique empêche le P2P (STUN insuffisant) | Message d'erreur clair ; TURN payant hors scope v1 |
| Fuite du QR (photo) | Accepté (usage réseau local) ; révocation manuelle + QR régénérable |
| `base` oublié → assets cassés sur `/babycam/` | `base: '/babycam/'` dans Vite + vérification en phase 0 |
| Relais indisponible (v2) | Le QR reste le mode d'appairage par défaut et le secours |
| Fuite du code de salon (v2) | Le code est le secret ; chiffrement E2E optionnel de la signalisation ; révocation côté caméra |
| Batterie (wake lock + caméra) | Indicateur d'état, bouton arrêt explicite, information à l'utilisateur |
| CPU de la détection | Analyse à basse fréquence/résolution (canvas 160 px, bruit via AnalyserNode) |
| SW qui cache trop vieux | `autoUpdate` + precache versionné par le build |

## 16. Points ouverts (défauts retenus en attendant)

- Nom de l'app : « Babycam » ; icônes : placeholder à remplacer.
- Nom affiché pour chaque viewer : saisi par le viewer à la connexion (champ libre).
- STUN : `stun:stun.l.google.com:19302` ; pas de TURN en v1.
- Push notifications : reportées en v2+ et hors périmètre « 100 % statique ».
- Relais v2 : URL du Worker Cloudflare à déployer (`relay/`) et décision sur le chiffrement E2E de la signalisation (clé dérivée du code de salon).
