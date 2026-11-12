import QRCode from 'qrcode';

export async function renderQr(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'L',
    margin: 1,
    width: 880,
    color: { dark: '#1e1b4b', light: '#ffffff' },
  });
  // toCanvas pose un style inline width/height: 880px qui écraserait la CSS
  // (min(340px, 100%)) et ferait déborder le QR de son volet : on le retire,
  // le backing store reste à 880 px (rendu net même affiché plus petit).
  canvas.style.width = '';
  canvas.style.height = '';
}
