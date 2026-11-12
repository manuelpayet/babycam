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
    'camera.pair.btn': 'Appairer un viewer',
    'camera.pair.waiting': 'En attente du viewer…',
    'camera.pair.roomLabel': 'Code de salon (QR ou copier) :',
    'camera.viewers': 'Viewers connectés',
    'camera.revoke': 'Révoquer',
    'camera.pair.connected': 'connecté',
    'camera.needStream': 'Démarre la caméra avant d’appairer.',
    'camera.relayNeeded': 'Relais non configuré (DEFAULT_RELAY_URL vide)',
    'camera.detect': 'Détection',
    'camera.detectHint': 'Les seuils de bruit et de mouvement se règlent côté viewer.',
    'alert.noise': '🔊 Bruit détecté !',
    'alert.motion': '👶 Mouvement détecté !',
    'viewer.joinRoom': 'Rejoindre le salon',
    'viewer.badRoom': 'Code de salon invalide (6 caractères).',
    'viewer.roomLabel': 'Code de salon :',
    'viewer.status.joined': 'Salon rejoint — caméras disponibles :',
    'viewer.title': 'Viewer',
    'viewer.status.idle': 'Non appairé',
    'viewer.unmute': 'Activer le son',
    'viewer.fullscreen': 'Plein écran',
    'viewer.pairing': 'Appairage',
    'viewer.scan': 'Scanner le QR de la caméra',
    'viewer.nameLabel': 'Votre nom :',
    'viewer.status.connected': 'Connecté — flux reçu',
    'viewer.status.lost': 'Connexion perdue',
    'viewer.status.reconnecting': 'Reconnexion en cours…',
    'viewer.alerts': 'Alertes',
    'viewer.detect': 'Détection',
    'viewer.noiseThreshold': 'Seuil de bruit',
    'viewer.motionSens': 'Sensibilité mouvement',
    'viewer.noiseLevel': 'Niveau sonore',
    'camera.wiz.step1': 'Lancer',
    'camera.wiz.step2': 'Code de salon',
    'camera.wiz.step3': 'Connecté',
    'camera.wiz.startHint': 'Démarrez la caméra, puis lancez l’appairage : un code de salon (QR) apparaîtra pour le viewer.',
    'camera.wiz.roomHint': 'Scannez ce QR depuis le viewer, ou donnez-lui le code de salon.',
    'camera.wiz.done': '✓ Viewer connecté — retour à la caméra…',
    'viewer.pairAgain': 'Réappairer',
    'viewer.wiz.step1': 'Code de salon',
    'viewer.wiz.step2': 'Connexion',
    'viewer.wiz.scanHint': 'Scannez le QR affiché par la caméra, ou entrez le code de salon ci-dessous.',
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
    'camera.pair.btn': 'Pair a viewer',
    'camera.pair.waiting': 'Waiting for viewer…',
    'camera.pair.roomLabel': 'Room code (QR or copy):',
    'camera.viewers': 'Connected viewers',
    'camera.revoke': 'Revoke',
    'camera.pair.connected': 'connected',
    'camera.needStream': 'Start the camera before pairing.',
    'camera.relayNeeded': 'No relay configured (empty DEFAULT_RELAY_URL)',
    'camera.detect': 'Detection',
    'camera.detectHint': 'Noise and motion thresholds are adjusted on the viewer side.',
    'alert.noise': '🔊 Noise detected!',
    'alert.motion': '👶 Motion detected!',
    'viewer.joinRoom': 'Join room',
    'viewer.badRoom': 'Invalid room code (6 characters).',
    'viewer.roomLabel': 'Room code:',
    'viewer.status.joined': 'Room joined — available cameras:',
    'viewer.title': 'Viewer',
    'viewer.status.idle': 'Not paired',
    'viewer.unmute': 'Enable sound',
    'viewer.fullscreen': 'Fullscreen',
    'viewer.pairing': 'Pairing',
    'viewer.scan': 'Scan the camera QR',
    'viewer.nameLabel': 'Your name:',
    'viewer.status.connected': 'Connected — stream received',
    'viewer.status.lost': 'Connection lost',
    'viewer.status.reconnecting': 'Reconnecting…',
    'viewer.alerts': 'Alerts',
    'viewer.detect': 'Detection',
    'viewer.noiseThreshold': 'Noise threshold',
    'viewer.motionSens': 'Motion sensitivity',
    'viewer.noiseLevel': 'Sound level',
    'camera.wiz.step1': 'Start',
    'camera.wiz.step2': 'Room code',
    'camera.wiz.step3': 'Connected',
    'camera.wiz.startHint': 'Start the camera, then start pairing: a room code (QR) will appear for the viewer.',
    'camera.wiz.roomHint': 'Scan this QR from the viewer, or give it the room code.',
    'camera.wiz.done': '✓ Viewer connected — back to the camera…',
    'viewer.pairAgain': 'Pair again',
    'viewer.wiz.step1': 'Room code',
    'viewer.wiz.step2': 'Connecting',
    'viewer.wiz.scanHint': 'Scan the QR shown by the camera, or enter the room code below.',
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
