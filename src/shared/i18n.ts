export type Lang = 'fr' | 'en';
export const LANGS: Lang[] = ['fr', 'en'];

const STORAGE_KEY = 'babycam.lang';

export const DICTS: Record<Lang, Record<string, string>> = {
  fr: {
    'app.title': 'Babycam',
    'home.subtitle': 'Surveille bébé depuis un autre appareil.',
    'home.camera': 'Je surveille (caméra)',
    'home.viewer': 'Je regarde (viewer)',
    'home.language': 'Langue',
    'camera.title': 'Caméra',
    'camera.status.idle': 'Caméra arrêtée',
    'camera.status.running': 'Caméra en cours…',
    'camera.start': 'Démarrer',
    'camera.stop': 'Arrêter',
    'camera.switch': 'Changer de caméra',
    'camera.torch': 'Torche',
    'camera.wakelock.on': 'Écran maintenu allumé',
    'camera.pairing': 'Appairage',
    'camera.pair.btn': 'Appairer un viewer (QR)',
    'camera.pair.waiting': 'En attente du viewer…',
    'camera.pair.offerLabel': 'Offre (QR ou copier-coller) :',
    'camera.pair.answerLabel': 'Réponse du viewer (coller ici) :',
    'camera.pair.applyAnswer': 'Connecter',
    'camera.viewers': 'Viewers connectés',
    'camera.revoke': 'Révoquer',
    'camera.pair.connected': 'connecté',
    'camera.needStream': 'Démarre la caméra avant d’appairer.',
    'camera.detect': 'Détection',
    'camera.detectHint': 'Les seuils de bruit et de mouvement se règlent côté viewer.',
    'alert.noise': '🔊 Bruit détecté !',
    'alert.motion': '👶 Mouvement détecté !',
    'camera.discovery': 'Découverte (salon)',
    'camera.createRoom': 'Créer un salon',
    'camera.relayNeeded': 'Relais non configuré (paramètre ?relay=)',
    'viewer.discovery': 'Découverte (salon)',
    'viewer.joinRoom': 'Rejoindre le salon',
    'viewer.badRoom': 'Code de salon invalide (6 caractères).',
    'viewer.status.joined': 'Salon rejoint — caméras disponibles :',
    'viewer.title': 'Viewer',
    'viewer.status.idle': 'Non appairé',
    'viewer.unmute': 'Activer le son',
    'viewer.fullscreen': 'Plein écran',
    'viewer.pairing': 'Appairage',
    'viewer.scan': 'Scanner le QR de la caméra',
    'viewer.pasteOffer': 'Ou coller l’offre :',
    'viewer.applyOffer': 'Générer la réponse',
    'viewer.answerLabel': 'Réponse à montrer à la caméra (QR ou copier) :',
    'viewer.offerReceived': 'Offre reçue, génération de la réponse…',
    'viewer.badOffer': 'Offre invalide.',
    'viewer.nameLabel': 'Votre nom :',
    'viewer.status.connected': 'Connecté — flux reçu',
    'viewer.status.lost': 'Connexion perdue',
    'viewer.status.reconnecting': 'Reconnexion en cours…',
    'viewer.alerts': 'Alertes',
    'viewer.detect': 'Détection',
    'viewer.noiseThreshold': 'Seuil de bruit',
    'viewer.motionSens': 'Sensibilité mouvement',
    'viewer.noiseLevel': 'Niveau sonore',
    'camera.scanAnswer': 'Scanner la réponse (caméra frontale)', 
    'camera.codecLabel': 'Codec vidéo :',
    'camera.pair.reconnect': 'Reconnexion : re-scanner le QR si demandé',
    'camera.wiz.step1': 'Lancer',
    'camera.wiz.step2': 'QR à montrer',
    'camera.wiz.step3': 'Réponse du viewer',
    'camera.wiz.step4': 'Connecté',
    'camera.wiz.startHint': 'Démarrez la caméra, puis lancez l’appairage : un QR apparaîtra à scanner depuis le viewer.',
    'camera.wiz.offerHint': 'Montrez ce QR au viewer (ou copiez l’offre ci-dessous).',
    'camera.wiz.answerHint': 'Le viewer affiche alors un QR de réponse : scannez-le avec la caméra frontale, ou collez-la ci-dessous.',
    'camera.wiz.done': '✓ Viewer connecté — retour à la caméra…',
    'viewer.pairAgain': 'Réappairer',
    'viewer.wiz.step1': 'Recevoir l’offre',
    'viewer.wiz.step2': 'Montrer la réponse',
    'viewer.wiz.step3': 'Connexion',
    'viewer.wiz.scanHint': 'Scannez le QR affiché par la caméra, ou collez l’offre / le code de salon ci-dessous.',
    'viewer.wiz.waiting': 'En attente de la connexion avec la caméra…',
    'diag.title': 'Diagnostic',
  },
  en: {
    'app.title': 'Babycam',
    'home.subtitle': 'Watch your baby from another device.',
    'home.camera': 'I monitor (camera)',
    'home.viewer': 'I watch (viewer)',
    'home.language': 'Language',
    'camera.title': 'Camera',
    'camera.status.idle': 'Camera off',
    'camera.status.running': 'Camera running…',
    'camera.start': 'Start',
    'camera.stop': 'Stop',
    'camera.switch': 'Switch camera',
    'camera.torch': 'Torch',
    'camera.wakelock.on': 'Screen kept on',
    'camera.pairing': 'Pairing',
    'camera.pair.btn': 'Pair a viewer (QR)',
    'camera.pair.waiting': 'Waiting for viewer…',
    'camera.pair.offerLabel': 'Offer (QR or copy-paste):',
    'camera.pair.answerLabel': 'Viewer answer (paste here):',
    'camera.pair.applyAnswer': 'Connect',
    'camera.viewers': 'Connected viewers',
    'camera.revoke': 'Revoke',
    'camera.pair.connected': 'connected',
    'camera.needStream': 'Start the camera before pairing.',
    'camera.detect': 'Detection',
    'camera.detectHint': 'Noise and motion thresholds are adjusted on the viewer side.',
    'alert.noise': '🔊 Noise detected!',
    'alert.motion': '👶 Motion detected!',
    'camera.discovery': 'Discovery (room)',
    'camera.createRoom': 'Create a room',
    'camera.relayNeeded': 'No relay configured (?relay= param)',
    'viewer.discovery': 'Discovery (room)',
    'viewer.joinRoom': 'Join room',
    'viewer.badRoom': 'Invalid room code (6 characters).',
    'viewer.status.joined': 'Room joined — available cameras:',
    'viewer.title': 'Viewer',
    'viewer.status.idle': 'Not paired',
    'viewer.unmute': 'Enable sound',
    'viewer.fullscreen': 'Fullscreen',
    'viewer.pairing': 'Pairing',
    'viewer.scan': 'Scan the camera QR',
    'viewer.pasteOffer': 'Or paste the offer:',
    'viewer.applyOffer': 'Generate answer',
    'viewer.answerLabel': 'Answer to show the camera (QR or copy):',
    'viewer.offerReceived': 'Offer received, generating answer…',
    'viewer.badOffer': 'Invalid offer.',
    'viewer.nameLabel': 'Your name:',
    'viewer.status.connected': 'Connected — stream received',
    'viewer.status.lost': 'Connection lost',
    'viewer.status.reconnecting': 'Reconnecting…',
    'viewer.alerts': 'Alerts',
    'viewer.detect': 'Detection',
    'viewer.noiseThreshold': 'Noise threshold',
    'viewer.motionSens': 'Motion sensitivity',
    'viewer.noiseLevel': 'Sound level',
    'camera.scanAnswer': 'Scan answer (front camera)', 
    'camera.codecLabel': 'Video codec:',
    'camera.pair.reconnect': 'Reconnecting: re-scan the QR if asked',
    'camera.wiz.step1': 'Start',
    'camera.wiz.step2': 'QR to show',
    'camera.wiz.step3': "Viewer's answer",
    'camera.wiz.step4': 'Connected',
    'camera.wiz.startHint': 'Start the camera, then start pairing: a QR will appear for the viewer to scan.',
    'camera.wiz.offerHint': 'Show this QR to the viewer (or copy the offer below).',
    'camera.wiz.answerHint': 'The viewer then shows an answer QR: scan it with the front camera, or paste it below.',
    'camera.wiz.done': '✓ Viewer connected — back to the camera…',
    'viewer.pairAgain': 'Pair again',
    'viewer.wiz.step1': 'Receive the offer',
    'viewer.wiz.step2': 'Show the answer',
    'viewer.wiz.step3': 'Connecting',
    'viewer.wiz.scanHint': 'Scan the QR shown by the camera, or paste the offer / room code below.',
    'viewer.wiz.waiting': 'Waiting for the camera connection…',
    'diag.title': 'Diagnostics',
  },
};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // stockage indisponible (ex. tests node) : on ignore
  }
}

function detectLang(): Lang {
  const saved = storageGet(STORAGE_KEY);
  if (saved === 'fr' || saved === 'en') return saved;
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let current: Lang = detectLang();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  storageSet(STORAGE_KEY, lang);
  applyTranslations();
}

export function t(key: string): string {
  return DICTS[current][key] ?? DICTS.en[key] ?? key;
}

export function applyTranslations(root?: ParentNode): void {
  const target = root ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return;
  target.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export function initLangSelect(select: HTMLSelectElement): void {
  select.value = current;
  select.addEventListener('change', () => setLang(select.value as Lang));
}
