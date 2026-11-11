import { Html5Qrcode } from 'html5-qrcode';

export class QrScanner {
  private html5: Html5Qrcode | null = null;

  constructor(
    private elementId: string,
    private onText: (text: string) => void,
  ) {}

  async start(facingMode: 'environment' | 'user' = 'environment'): Promise<void> {
    this.html5 = new Html5Qrcode(this.elementId);
    await this.html5.start(
      { facingMode },
      { fps: 10, qrbox: 250 },
      (text) => this.onText(text),
      () => undefined,
    );
  }

  async stop(): Promise<void> {
    if (!this.html5) return;
    try {
      await this.html5.stop();
      await this.html5.clear();
    } catch {
      // déjà arrêté
    }
    this.html5 = null;
  }
}
