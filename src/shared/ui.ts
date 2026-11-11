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
