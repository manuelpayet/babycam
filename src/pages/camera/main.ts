import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';
import { WakeLockManager } from '../../shared/wakelock';
import { createChunkCollector, decodeMessage, encodeMessage, toQrChunks } from '../../shared/signaling';
import { QrCarousel, qs } from '../../shared/ui';
import { QrScanner } from '../../shared/scanner';
import { CameraPeers, iceServersFromLocation, type AlertKind } from '../../shared/webrtc';
import { NoiseDetector } from '../../shared/detection/noise';
import { MotionDetector } from '../../shared/detection/motion';
import { RelayClient, newRoomCode } from '../../shared/relay';
import type { SignalMessage } from '../../shared/signaling';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);

const preview = qs<HTMLVideoElement>('#preview');
const status = qs<HTMLParagraphElement>('#status');
const startBtn = qs<HTMLButtonElement>('#start-btn');
const stopBtn = qs<HTMLButtonElement>('#stop-btn');
const switchBtn = qs<HTMLButtonElement>('#switch-cam');
const torchBtn = qs<HTMLButtonElement>('#torch-btn');

let stream: MediaStream | null = null;
let facing: 'environment' | 'user' = 'environment';

const wakeLock = new WakeLockManager();
const wakeLockStatus = qs<HTMLParagraphElement>('#wakelock-status');
wakeLock.onChange = (active) => {
  wakeLockStatus.textContent = active ? `🔒 ${t('camera.wakelock.on')}` : '';
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && stream) void wakeLock.onVisible();
});

function setStatus(text: string): void {
  status.textContent = text;
}

function setStatusKey(key: string): void {
  setStatus(t(key));
}

async function start(): Promise<void> {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  preview.srcObject = stream;
  await preview.play().catch(() => undefined);
  await wakeLock.request();
  noiseDet = new NoiseDetector(stream, {
    threshold: Number(noiseThreshold.value),
    onTrigger: (dbfs) => onAlert('noise', Math.round(dbfs)),
    onLevel: (dbfs) => peers?.sendToAll({ type: 'level', dbfs: Math.round(dbfs) }),
  });
  noiseDet.start();
  motionDet = new MotionDetector(preview, {
    sensitivity: Number(motionSens.value),
    onTrigger: (ratio) => onAlert('motion', Math.round(ratio * 1000) / 10),
  });
  motionDet.start();
  setStatusKey('camera.status.running');
  startBtn.disabled = true;
  stopBtn.disabled = false;
}

function stop(): void {
  noiseDet?.stop();
  noiseDet = null;
  motionDet?.stop();
  motionDet = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  preview.srcObject = null;
  void wakeLock.release();
  setStatusKey('camera.status.idle');
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener('click', () => {
  start().catch((err: unknown) => setStatus(String(err)));
});
stopBtn.addEventListener('click', stop);
switchBtn.addEventListener('click', () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  if (stream) {
    stop();
    start().catch((err: unknown) => setStatus(String(err)));
  }
});
torchBtn.addEventListener('click', () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
  if (!caps.torch) return;
  const settings = track.getSettings() as MediaTrackSettings & { torch?: boolean };
  const constraints = { advanced: [{ torch: !settings.torch }] } as unknown as MediaTrackConstraints;
  track.applyConstraints(constraints).catch(() => undefined);
});

stopBtn.disabled = true;
setStatusKey('camera.status.idle');

const noiseThreshold = qs<HTMLInputElement>('#noise-threshold');
const motionSens = qs<HTMLInputElement>('#motion-sens');
const flash = qs<HTMLDivElement>('#flash');
const NOISE_KEY = 'babycam.noiseThreshold';
const MOTION_KEY = 'babycam.motionSens';
noiseThreshold.value = localStorage.getItem(NOISE_KEY) ?? '70';
motionSens.value = localStorage.getItem(MOTION_KEY) ?? '50';
let noiseDet: NoiseDetector | null = null;
let motionDet: MotionDetector | null = null;

function onAlert(kind: AlertKind, level: number): void {
  peers?.sendToAll({ type: 'alert', kind, level, ts: Date.now() });
  flash.hidden = false;
  flash.classList.remove('on');
  void flash.offsetWidth;
  flash.classList.add('on');
  setTimeout(() => {
    flash.hidden = true;
  }, 600);
  void wakeLock.onVisible();
}

noiseThreshold.addEventListener('input', () => {
  localStorage.setItem(NOISE_KEY, noiseThreshold.value);
  if (noiseDet) noiseDet.threshold = Number(noiseThreshold.value);
});

motionSens.addEventListener('input', () => {
  localStorage.setItem(MOTION_KEY, motionSens.value);
  if (motionDet) motionDet.sensitivity = Number(motionSens.value);
});

const pairBtn = qs<HTMLButtonElement>('#pair-btn');
const qrBox = qs<HTMLDivElement>('#qr-box');
const qrCanvas = qs<HTMLCanvasElement>('#qr-canvas');
const qrPos = qs<HTMLSpanElement>('#qr-pos');
const offerPayload = qs<HTMLTextAreaElement>('#offer-payload');
const answerPayload = qs<HTMLTextAreaElement>('#answer-payload');
const applyAnswerBtn = qs<HTMLButtonElement>('#apply-answer-btn');
const viewersList = qs<HTMLUListElement>('#viewers');

let peers: CameraPeers | null = null;
let pendingPeerId: string | null = null;
let carousel: QrCarousel | null = null;

function renderViewers(): void {
  viewersList.innerHTML = '';
  for (const p of peers?.list ?? []) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${p.name} (${p.state})`;
    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'btn btn-small';
    revokeBtn.textContent = t('camera.revoke');
    revokeBtn.addEventListener('click', () => peers?.revoke(p.id));
    li.append(label, ' ', revokeBtn);
    viewersList.append(li);
  }
}

function ensurePeers(iceServers: RTCIceServer[]): CameraPeers {
  if (!peers) {
    peers = new CameraPeers(stream!, iceServers, {
      onRenegotiate: (id, msg) => {
        const from = relayFromByPeer.get(id);
        if (relay && from) {
          relay.signal(from, msg);
        } else {
          const message = encodeMessage(msg);
          offerPayload.value = message;
          qrBox.hidden = false;
          carousel?.stop();
          carousel = new QrCarousel(qrCanvas, qrPos, toQrChunks(message));
          void carousel.start();
          setStatusKey('camera.pair.reconnect');
        }
      },
    });
    peers.onPeerChange = () => renderViewers();
  }
  return peers;
}

pairBtn.addEventListener('click', async () => {
  if (!stream) {
    setStatusKey('camera.needStream');
    return;
  }
  const { id, msg } = await ensurePeers([]).createOffer();
  pendingPeerId = id;
  const message = encodeMessage(msg);
  offerPayload.value = message;
  qrBox.hidden = false;
  answerBox.hidden = false;
  carousel?.stop();
  carousel = new QrCarousel(qrCanvas, qrPos, toQrChunks(message));
  await carousel.start();
  setStatusKey('camera.pair.waiting');
});

const answerBox = qs<HTMLDivElement>('#answer-box');
const scanAnswerBtn = qs<HTMLButtonElement>('#scan-answer-btn');
const qrReaderAnswer = qs<HTMLDivElement>('#qr-reader-answer');

async function applyAnswer(): Promise<void> {
  if (!peers || !pendingPeerId) return;
  try {
    const msg = decodeMessage(answerPayload.value);
    await peers.acceptAnswer(pendingPeerId, msg);
    carousel?.stop();
    setStatusKey('camera.pair.connected');
  } catch (err) {
    setStatus(String(err));
  }
}

applyAnswerBtn.addEventListener('click', () => void applyAnswer());

let answerCollector = createChunkCollector();
const answerScanner = new QrScanner('qr-reader-answer', (text) => {
  const full = answerCollector.add(text) ?? (text.startsWith('BCAM1:') ? text : null);
  if (!full) return;
  void answerScanner.stop();
  qrReaderAnswer.hidden = true;
  answerPayload.value = full;
  void applyAnswer();
});

scanAnswerBtn.addEventListener('click', () => {
  answerCollector = createChunkCollector();
  qrReaderAnswer.hidden = false;
  answerScanner.start('user').catch((err: unknown) => setStatus(String(err)));
});

const relayParam = new URLSearchParams(location.search).get('relay');
const createRoomBtn = qs<HTMLButtonElement>('#create-room-btn');
const roomCodeEl = qs<HTMLParagraphElement>('#room-code');
const relayStatus = qs<HTMLParagraphElement>('#relay-status');
let relay: RelayClient | null = null;
const relayFromByPeer = new Map<string, string>();

createRoomBtn.addEventListener('click', async () => {
  if (!stream) {
    setStatusKey('camera.needStream');
    return;
  }
  if (!relayParam) {
    setStatusKey('camera.relayNeeded');
    return;
  }
  ensurePeers(iceServersFromLocation());
  relay = new RelayClient(relayParam);
  const room = newRoomCode();
  try {
    await relay.connect(room, 'camera', 'Caméra', { autoReconnect: true });
  } catch (err) {
    setStatus(String(err));
    return;
  }
  relay.onReconnecting = (attempt, delay) => {
    relayStatus.textContent = `${relayParam} — reconnexion #${attempt} dans ${delay} ms`;
  };
  roomCodeEl.textContent = room;
  roomCodeEl.hidden = false;
  relayStatus.textContent = relayParam;
  relay.onRequest = async (from) => {
    const { id, msg } = await peers!.createOffer();
    relayFromByPeer.set(id, from);
    relay!.signal(from, msg);
  };
  relay.onSignal = async (from, msg) => {
    const peerId = [...relayFromByPeer.entries()].find(([, f]) => f === from)?.[0];
    if (peerId && (msg as SignalMessage).t === 'answer') {
      await peers!.acceptAnswer(peerId, msg as SignalMessage);
      setStatusKey('camera.pair.connected');
    }
  };
});

if (new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__babycam = {
    getStream: () => stream,
    wakeLockActive: () => wakeLock.active,
    getPeers: () => peers?.list ?? [],
    sendToAll: (m: unknown) => peers?.sendToAll(m as never),
    getRoomCode: () => roomCodeEl.textContent ?? '',
  };
}
