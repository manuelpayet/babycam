import { t } from './i18n';
import type { AlertKind } from './webrtc';

export function playAlertSound(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    for (const start of [now, now + 0.25]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    }
    setTimeout(() => void ctx.close().catch(() => undefined), 1000);
  } catch {
    // audio indisponible : on ignore
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // vibration indisponible
  }
}

export function alertText(kind: AlertKind): string {
  return t(kind === 'noise' ? 'alert.noise' : 'alert.motion');
}

export function showAlertBanner(banner: HTMLElement, kind: AlertKind): void {
  banner.textContent = alertText(kind);
  banner.hidden = false;
  setTimeout(() => {
    banner.hidden = true;
  }, 5000);
}

export function pushAlertHistory(list: HTMLUListElement, kind: AlertKind, ts: number): void {
  const li = document.createElement('li');
  const time = new Date(ts).toLocaleTimeString();
  li.textContent = `${time} — ${alertText(kind)}`;
  list.prepend(li);
  while (list.children.length > 20) list.lastElementChild?.remove();
}
