import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';
import { createChunkCollector, decodeMessage, type SignalMessage } from '../../shared/signaling';
import { QrScanner } from '../../shared/scanner';
import { qs } from '../../shared/ui';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);

const status = qs<HTMLParagraphElement>('#status');
const scanBtn = qs<HTMLButtonElement>('#scan-offer-btn');
const qrReader = qs<HTMLDivElement>('#qr-reader');
const offerInput = qs<HTMLTextAreaElement>('#offer-input');
const applyOfferBtn = qs<HTMLButtonElement>('#apply-offer-btn');

function setStatus(text: string): void {
  status.textContent = text;
}

const collector = createChunkCollector();
let pendingOffer: SignalMessage | null = null;

const scanner = new QrScanner('qr-reader', (text) => {
  const full = collector.add(text) ?? (text.startsWith('BCAM1:') ? text : null);
  if (!full) return;
  void scanner.stop();
  qrReader.hidden = true;
  offerInput.value = full;
  applyOffer();
});

scanBtn.addEventListener('click', () => {
  qrReader.hidden = false;
  scanner.start('environment').catch((err: unknown) => setStatus(String(err)));
});

function applyOffer(): void {
  try {
    pendingOffer = decodeMessage(offerInput.value);
    setStatus(t('viewer.offerReceived'));
  } catch {
    pendingOffer = null;
    setStatus(t('viewer.badOffer'));
  }
}

applyOfferBtn.addEventListener('click', applyOffer);

setStatus(t('viewer.status.idle'));

if (new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__babycam = {
    getPendingOffer: () => pendingOffer,
  };
}
