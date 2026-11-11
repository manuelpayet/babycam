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
    'viewer.title': 'Viewer',
    'viewer.status.idle': 'Non appairé',
    'viewer.unmute': 'Activer le son',
    'viewer.fullscreen': 'Plein écran',
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
    'viewer.title': 'Viewer',
    'viewer.status.idle': 'Not paired',
    'viewer.unmute': 'Enable sound',
    'viewer.fullscreen': 'Fullscreen',
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
