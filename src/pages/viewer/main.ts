import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';
import { createChunkCollector, decodeMessage, encodeMessage, toQrChunks, type SignalMessage } from '../../shared/signaling';
import { QrScanner } from '../../shared/scanner';
import { QrCarousel, qs } from '../../shared/ui';
import { iceServersFromLocation, ViewerPeer } from '../../shared/webrtc';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);

const status = qs<HTMLParagraphElement>('#status');
const remote = qs<HTMLVideoElement>('#remote');
const unmuteBtn = qs<HTMLButtonElement>('#unmute-btn');
const fullscreenBtn = qs<HTMLButtonElement>('#fullscreen-btn');
const scanBtn = qs<HTMLButtonElement>('#scan-offer-btn');
const qrReader = qs<HTMLDivElement>('#qr-reader');
const offerInput = qs<HTMLTextAreaElement>('#offer-input');
const applyOfferBtn = qs<HTMLButtonElement>('#apply-offer-btn');
const qrBoxAnswer = qs<HTMLDivElement>('#qr-box-answer');
const qrCanvasAnswer = qs<HTMLCanvasElement>('#qr-canvas-answer');
const qrPosAnswer = qs<HTMLSpanElement>('#qr-pos-answer');
const answerPayload = qs<HTMLTextAreaElement>('#answer-payload');
const viewerName = qs<HTMLInputElement>('#viewer-name');

function setStatus(text: string): void {
  status.textContent = text;
}

let peer: ViewerPeer | null = null;
let answerCarousel: QrCarousel | null = null;

const collector = createChunkCollector();

const scanner = new QrScanner('qr-reader', (text) => {
  const full = collector.add(text) ?? (text.startsWith('BCAM1:') ? text : null);
  if (!full) return;
  void scanner.stop();
  qrReader.hidden = true;
  offerInput.value = full;
  void applyOffer();
});

scanBtn.addEventListener('click', () => {
  qrReader.hidden = false;
  scanner.start('environment').catch((err: unknown) => setStatus(String(err)));
});

async function applyOffer(): Promise<void> {
  let msg: SignalMessage;
  try {
    msg = decodeMessage(offerInput.value);
  } catch {
    setStatus(t('viewer.badOffer'));
    return;
  }
  setStatus(t('viewer.offerReceived'));
  peer = new ViewerPeer(iceServersFromLocation(), viewerName.value.trim() || 'Viewer');
  peer.onTrack = (s) => {
    remote.srcObject = s;
    remote.muted = true;
    void remote.play().catch(() => undefined);
  };
  peer.onData = () => {
    // v2 : alertes bruit/mouvement affichées ici
  };
  peer.onState = (state) => {
    if (state === 'connected') setStatus(t('viewer.status.connected'));
    else if (state === 'failed' || state === 'disconnected' || state === 'closed') setStatus(t('viewer.status.lost'));
  };
  try {
    const answer = await peer.acceptOffer(msg);
    const message = encodeMessage(answer);
    answerPayload.value = message;
    qrBoxAnswer.hidden = false;
    answerCarousel?.stop();
    answerCarousel = new QrCarousel(qrCanvasAnswer, qrPosAnswer, toQrChunks(message));
    await answerCarousel.start();
  } catch (err) {
    setStatus(String(err));
  }
}

applyOfferBtn.addEventListener('click', () => void applyOffer());

unmuteBtn.addEventListener('click', () => {
  remote.muted = false;
  void remote.play().catch(() => undefined);
});

fullscreenBtn.addEventListener('click', () => {
  remote.requestFullscreen?.().catch(() => undefined);
});

setStatus(t('viewer.status.idle'));

if (new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__babycam = {
    getPeerState: () => peer?.pc?.connectionState ?? null,
  };
}
