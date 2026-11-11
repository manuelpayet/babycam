import QRCode from 'qrcode';

export async function renderQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'L',
    margin: 1,
    width: 280,
    color: { dark: '#1e1b4b', light: '#ffffff' },
  });
}
