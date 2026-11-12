export function lumaDiffRatio(a: Uint8ClampedArray, b: Uint8ClampedArray, pixelThreshold = 25): number {
  if (a.length !== b.length) throw new Error('size mismatch');
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
    if (Math.abs(la - lb) > pixelThreshold) changed++;
  }
  return changed / (a.length / 4);
}

export function sensitivityToRatio(sensitivity: number): number {
  return 0.105 - (sensitivity / 100) * 0.1;
}

export interface MotionDetectorOptions {
  sensitivity: number;
  onTrigger: (ratio: number) => void;
  intervalMs?: number;
  cooldownMs?: number;
  width?: number;
  pixelThreshold?: number;
}

export class MotionDetector {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private prev: Uint8ClampedArray | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTrigger = 0;

  constructor(
    private video: HTMLVideoElement,
    private opts: MotionDetectorOptions,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = opts.width ?? 160;
    this.canvas.height = Math.round((opts.width ?? 160) * 9 / 16);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  get ratioThreshold(): number {
    return sensitivityToRatio(this.opts.sensitivity);
  }

  set sensitivity(value: number) {
    this.opts.sensitivity = value;
  }

  start(): void {
    const intervalMs = this.opts.intervalMs ?? 200;
    const cooldownMs = this.opts.cooldownMs ?? 2000;
    this.timer = setInterval(() => {
      if (this.video.readyState < 2) return;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      if (this.prev) {
        const ratio = lumaDiffRatio(frame, this.prev, this.opts.pixelThreshold ?? 15);
        const now = performance.now();
        if (ratio > this.ratioThreshold && now - this.lastTrigger >= cooldownMs) {
          this.lastTrigger = now;
          this.opts.onTrigger(ratio);
        }
      }
      this.prev = frame;
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
