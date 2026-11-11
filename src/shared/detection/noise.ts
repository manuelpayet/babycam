export function rmsToDbfs(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}

export function thresholdToDbfs(threshold: number): number {
  return -60 + (threshold / 100) * 60;
}

export interface NoiseDetectorOptions {
  threshold: number;
  onTrigger: (dbfs: number) => void;
  onLevel?: (dbfs: number) => void;
  minDurationMs?: number;
  cooldownMs?: number;
  intervalMs?: number;
}

export class NoiseDetector {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private aboveSince = 0;
  private lastTrigger = 0;
  private lastLevelSent = 0;

  constructor(
    private stream: MediaStream,
    private opts: NoiseDetectorOptions,
  ) {}

  get thresholdDbfs(): number {
    return thresholdToDbfs(this.opts.threshold);
  }

  set threshold(value: number) {
    this.opts.threshold = value;
  }

  start(): void {
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    const intervalMs = this.opts.intervalMs ?? 150;
    const minDurationMs = this.opts.minDurationMs ?? 400;
    const cooldownMs = this.opts.cooldownMs ?? 5000;
    this.timer = setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      const dbfs = rmsToDbfs(buffer);
      const now = performance.now();
      if (now - this.lastLevelSent >= 500) {
        this.lastLevelSent = now;
        this.opts.onLevel?.(dbfs);
      }
      if (dbfs > this.thresholdDbfs) {
        if (this.aboveSince === 0) this.aboveSince = now;
        if (now - this.aboveSince >= minDurationMs && now - this.lastTrigger >= cooldownMs) {
          this.lastTrigger = now;
          this.aboveSince = 0;
          this.opts.onTrigger(dbfs);
        }
      } else {
        this.aboveSince = 0;
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
