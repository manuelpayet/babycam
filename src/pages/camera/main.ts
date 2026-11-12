import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';
import { WakeLockManager } from '../../shared/wakelock';
import { encodeRoom } from '../../shared/signaling';
import { QrCarousel, qs, setBuildBadge, Wizard, goView, initHashViews } from '../../shared/ui';
import { registerPwa } from '../../shared/pwa';
import { CameraPeers, iceServersFromLocation, type AlertKind, type SettingsMessage } from '../../shared/webrtc';
import { NoiseDetector } from '../../shared/detection/noise';
import { MotionDetector } from '../../shared/detection/motion';
import { RelayClient, newRoomCode, relayUrlFromLocation } from '../../shared/relay';
import { addDiagLog, candidateAddress } from '../../shared/diag';
import type { SignalMessage } from '../../shared/signaling';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);
registerPwa();
setBuildBadge();
initHashViews(false);

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
    threshold: storedNumber(NOISE_KEY, 70),
    onTrigger: (dbfs) => onAlert('noise', Math.round(dbfs)),
    onLevel: (dbfs) => peers?.sendToAll({ type: 'level', dbfs: Math.round(dbfs) }),
  });
  noiseDet.start();
  motionDet = new MotionDetector(preview, {
    sensitivity: storedNumber(MOTION_KEY, 50),
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

const flash = qs<HTMLDivElement>('#flash');
const NOISE_KEY = 'babycam.noiseThreshold';
const MOTION_KEY = 'babycam.motionSens';
let noiseDet: NoiseDetector | null = null;
let motionDet: MotionDetector | null = null;

function storedNumber(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key) ?? fallback);
  return Number.isFinite(v) ? v : fallback;
}

function applySettings(m: SettingsMessage): void {
  localStorage.setItem(NOISE_KEY, String(m.noiseThreshold));
  localStorage.setItem(MOTION_KEY, String(m.motionSens));
  if (noiseDet) noiseDet.threshold = m.noiseThreshold;
  if (motionDet) motionDet.sensitivity = m.motionSens;
}

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

const pairBtn = qs<HTMLButtonElement>('#pair-btn');
const qrCanvas = qs<HTMLCanvasElement>('#qr-canvas');
const qrPos = qs<HTMLSpanElement>('#qr-pos');
const roomPayload = qs<HTMLTextAreaElement>('#room-payload');
const viewersList = qs<HTMLUListElement>('#viewers');

let peers: CameraPeers | null = null;
let carousel: QrCarousel | null = null;

// Wizard d'appairage (100 % relais) : étapes 0=démarrer, 1=code de salon (QR), 2=connecté.
const pairWizard = new Wizard(qs<HTMLElement>('#pairing'));
pairWizard.show(0);

const diagRelay = qs<HTMLParagraphElement>('#diag-relay');
const diagPeers = qs<HTMLUListElement>('#diag-peers');
const diagLog = qs<HTMLUListElement>('#diag-log');

function renderDiag(): void {
  diagRelay.textContent = `relais ${relayUrlFromLocation() ?? 'non configuré'} — ws=${relay ? relay.wsState : 3}${relay ? ` — id=${relay.id || '…'}` : ''}`;
  diagPeers.innerHTML = '';
  for (const p of peers?.list ?? []) {
    const li = document.createElement('li');
    li.textContent = `${p.name} [${p.state}/${p.iceConnectionState}/${p.iceGatheringState}/${p.signalingState}] local: ${p.localCandidates.map(candidateAddress).join(', ') || '…'} | remote: ${p.remoteCandidates.map(candidateAddress).join(', ') || '…'}`;
    diagPeers.append(li);
  }
}
setInterval(renderDiag, 1000);

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
      onCandidate: (id, cand) => {
        const from = relayFromByPeer.get(id);
        if (relay && from) relay.candidate(from, cand);
      },
      onRenegotiate: (id, msg) => {
        const from = relayFromByPeer.get(id);
        if (relay && from) relay.signal(from, msg);
      },
    });
    peers.onPeerChange = () => renderViewers();
    peers.onData = (_id, m) => {
      if (m.type === 'settings') applySettings(m);
    };
  }
  return peers;
}

// Appairage 100 % relais : on crée un salon et le QR ne contient que son code.
async function startPairing(): Promise<void> {
  if (!stream) {
    setStatusKey('camera.needStream');
    return;
  }
  const relayUrl = relayUrlFromLocation();
  if (!relayUrl) {
    setStatusKey('camera.relayNeeded');
    return;
  }
  try {
    const room = await startRelayRoom(relayUrl);
    const message = encodeRoom(room);
    roomPayload.value = message;
    pairWizard.show(1);
    roomCodeEl.textContent = room;
    roomCodeEl.hidden = false;
    carousel?.stop();
    carousel = new QrCarousel(qrCanvas, qrPos, [message]);
    await carousel.start();
    setStatusKey('camera.pair.waiting');
  } catch (err) {
    setStatus(String(err));
    addDiagLog(diagLog, `erreur appairage relais: ${String(err)}`);
  }
}

pairBtn.addEventListener('click', () => {
  goView('pair');
  void startPairing();
});
qs<HTMLButtonElement>('#pair-start-btn').addEventListener('click', () => void startPairing());

const roomCodeEl = qs<HTMLParagraphElement>('#room-code');
const relayStatus = qs<HTMLParagraphElement>('#relay-status');
let relay: RelayClient | null = null;
const relayFromByPeer = new Map<string, string>();

async function startRelayRoom(relayUrl: string): Promise<string> {
  ensurePeers(iceServersFromLocation());
  relay = new RelayClient(relayUrl);
  const room = newRoomCode();
  const pendingFrom = new Set<string>();
  relay.onReconnecting = (attempt, delay) => {
    relayStatus.textContent = `${relayUrl} — reconnexion #${attempt} dans ${delay} ms`;
  };
  relayStatus.textContent = relayUrl;
  relay.onRequest = async (from) => {
    const existing = [...relayFromByPeer.entries()].find(([, f]) => f === from);
    if (existing) {
      const state = peers?.list.find((p) => p.id === existing[0])?.state;
      if (state === 'new' || state === 'connecting' || state === 'connected') return;
    }
    if (pendingFrom.has(from)) return;
    pendingFrom.add(from);
    addDiagLog(diagLog, `requête reçue de ${from.slice(0, 8)}…`);
    try {
      const { id, msg } = await ensurePeers(iceServersFromLocation()).createOffer();
      relayFromByPeer.set(id, from);
      relay!.signal(from, msg);
      const buffered = peers?.list.find((p) => p.id === id)?.localCandidates ?? [];
      for (const c of buffered) relay!.candidate(from, { candidate: c });
      addDiagLog(diagLog, `offre envoyée à ${from.slice(0, 8)}… (${buffered.length} candidats déjà collectés)`);
    } finally {
      pendingFrom.delete(from);
    }
  };
  relay.onCandidate = (from, cand) => {
    const peerId = [...relayFromByPeer.entries()].find(([, f]) => f === from)?.[0];
    if (peerId) peers?.addCandidate(peerId, cand);
  };
  relay.onSignal = async (from, msg) => {
    const m = msg as SignalMessage;
    const peerId = [...relayFromByPeer.entries()].find(([, f]) => f === from)?.[0];
    if (m.t === 'candidate') {
      if (peerId && m.candidate) peers?.addCandidate(peerId, m.candidate);
      return;
    }
    if (peerId && m.t === 'answer' && typeof m.sdp === 'string') {
      await peers!.acceptAnswer(peerId, m);
      pairWizard.show(pairWizard.count);
      goView('main');
      setStatusKey('camera.pair.connected');
      addDiagLog(diagLog, `réponse appliquée pour ${from.slice(0, 8)}…`);
    }
  };
  await relay.connect(room, 'camera', 'Caméra', { autoReconnect: true });
  addDiagLog(diagLog, `salon créé: ${room}`);
  return room;
}

if (new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__babycam = {
    getStream: () => stream,
    wakeLockActive: () => wakeLock.active,
    getPeers: () => peers?.list ?? [],
    sendToAll: (m: unknown) => peers?.sendToAll(m as never),
    getRoomCode: () => roomCodeEl.textContent ?? '',
    getNoiseThresholdDbfs: () => noiseDet?.thresholdDbfs ?? null,
    getMotionRatioThreshold: () => motionDet?.ratioThreshold ?? null,
  };
}
