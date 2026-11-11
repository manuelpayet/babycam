export interface WakeLockSentinelLike extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

export interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function defaultProvider(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

export class WakeLockManager {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private lastNotified = false;
  onChange?: (active: boolean) => void;

  constructor(private provider: () => WakeLockLike | undefined = defaultProvider) {}

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  private notify(active: boolean): void {
    if (this.lastNotified === active) return;
    this.lastNotified = active;
    this.onChange?.(active);
  }

  async request(): Promise<boolean> {
    this.wanted = true;
    const wakeLock = this.provider();
    if (!wakeLock) return false;
    try {
      this.sentinel = await wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.notify(false);
      });
      this.notify(true);
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    this.wanted = false;
    await this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
    this.notify(false);
  }

  async onVisible(): Promise<void> {
    if (this.wanted) await this.request();
  }
}
