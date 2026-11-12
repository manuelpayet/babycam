import { BUILD_ID } from './build';
import { renderQr } from './qr';

export function qs<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`élément introuvable: ${selector}`);
  return el;
}

export function setBuildBadge(): void {
  const el = document.querySelector('#build-badge');
  if (el) el.textContent = `v${BUILD_ID}`;
}

// Vues plein écran routées par hash : '' ou '#/' = vue principale, '#/pair' = page d'appairage dédiée.
// (Un vrai document séparé est impossible ici : le MediaStream et la RTCPeerConnection
// ne survivent pas à une navigation entre documents.)
export function initHashViews(pairByDefault: boolean): void {
  const apply = (): void => {
    const pair = location.hash === '#/pair' || (pairByDefault && location.hash !== '#/');
    document.body.classList.toggle('view-pair', pair);
    document.body.classList.toggle('view-main', !pair);
  };
  window.addEventListener('hashchange', apply);
  apply();
}

export function goView(view: 'main' | 'pair'): void {
  location.hash = view === 'pair' ? '#/pair' : '#/';
}

export class QrCarousel {
  private index = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private canvas: HTMLCanvasElement,
    private pos: HTMLElement,
    private chunks: string[],
    private intervalMs = 900,
  ) {}

  async start(): Promise<void> {
    await this.show();
    this.timer = setInterval(() => void this.show(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async show(): Promise<void> {
    try {
      await renderQr(this.canvas, this.chunks[this.index]);
    } catch {
      this.pos.textContent = 'QR trop dense : utiliser le copier-coller ci-dessous';
      return;
    }
    this.pos.textContent = this.chunks.length > 1 ? `${this.index + 1}/${this.chunks.length}` : '';
    this.index = (this.index + 1) % this.chunks.length;
  }
}

export class Wizard {
  private panes: HTMLElement[];
  private steps: HTMLElement[];
  private skipped = new Set<number>();

  constructor(root: HTMLElement) {
    this.panes = [...root.querySelectorAll<HTMLElement>('.wizard-pane')];
    this.steps = [...root.querySelectorAll<HTMLElement>('.wizard-steps li')];
  }

  get count(): number {
    return this.panes.length;
  }

  skip(index: number): void {
    this.skipped.add(index);
  }

  unskip(index: number): void {
    this.skipped.delete(index);
  }

  show(index: number): void {
    const i = Math.max(0, Math.min(index, this.panes.length));
    this.panes.forEach((p, k) => {
      p.hidden = k > i || this.skipped.has(k);
    });
    this.steps.forEach((s, k) => {
      const done = k < i || this.skipped.has(k);
      s.classList.toggle('done', done);
      s.classList.toggle('active', k === i && !done);
    });
  }
}
