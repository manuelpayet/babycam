import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';
import { createChunkCollector, decodeMessage, decodeRoom, encodeMessage, toQrChunks, type SignalMessage } from '../../shared/signaling';
import { QrScanner } from '../../shared/scanner';
import { QrCarousel, qs, setBuildBadge } from '../../shared/ui';
import { registerPwa } from '../../shared/pwa';
import { mungeSdpAggressive, videoMimeFromSdp } from '../../shared/sdp';
import { iceServersFromLocation, ViewerPeer, type DataMessage } from '../../shared/webrtc';
import { playAlertSound, pushAlertHistory, showAlertBanner, vibrate } from '../../shared/alerts';
import { RelayClient, relayUrlFromLocation } from '../../shared/relay';
import { addDiagLog, candidateAddress } from '../../shared/diag';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);
registerPwa();
setBuildBadge();

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
const alertBanner = qs<HTMLDivElement>('#alert-banner');
const alertHistory = qs<HTMLUListElement>('#alert-history');
const roomInput = qs<HTMLInputElement>('#room-input');
const joinRoomBtn = qs<HTMLButtonElement>('#join-room-btn');
const cameraList = qs<HTMLUListElement>('#camera-list');

function setStatus(text: string): void {
  status.textContent = text;
}

let peer: ViewerPeer | null = null;
let answerCarousel: QrCarousel | null = null;
const dataLog: DataMessage[] = [];
let relay: RelayClient | null = null;
let lastCameraFrom: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
const relayParam = relayUrlFromLocation();

function requestReconnect(): void {
  if (!relay || !lastCameraFrom) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (peer?.pc?.connectionState !== 'connected') relay?.request(lastCameraFrom!);
  }, 3000);
}

const diagRelay = qs<HTMLParagraphElement>('#diag-relay');
const diagPeers = qs<HTMLUListElement>('#diag-peers');
const diagLog = qs<HTMLUListElement>('#diag-log');

function renderDiag(): void {
  diagRelay.textContent = relayParam
    ? `relais ${relayParam} — ws=${relay ? relay.wsState : 3}${relay ? ` — id=${relay.id || '…'}` : ''} — cameras=${relay?.cameras.length ?? 0}`
    : 'relais : désactivé (mode QR local)';
  diagPeers.innerHTML = '';
  const pc = peer?.pc;
  if (pc) {
    const li = document.createElement('li');
    li.textContent = `peer [${pc.connectionState}/${pc.iceConnectionState}/${pc.iceGatheringState}/${pc.signalingState}] local: ${peer!.localCandidates.map(candidateAddress).join(', ') || '…'} | remote: ${peer!.remoteCandidates.map(candidateAddress).join(', ') || '…'}`;
    diagPeers.append(li);
  }
}
setInterval(renderDiag, 1000);

function makePeer(iceServers: RTCIceServer[], trickle = false): ViewerPeer {
  const p = new ViewerPeer(iceServers, viewerName.value.trim() || 'Viewer', trickle);
  p.onCandidate = (cand) => {
    if (relay && lastCameraFrom) relay.candidate(lastCameraFrom, cand);
  };
  p.onTrack = (s) => {
    remote.srcObject = s;
    remote.muted = true;
    void remote.play().catch(() => undefined);
  };
  p.onData = (m) => {
    dataLog.push(m);
    if (m.type === 'alert') {
      showAlertBanner(alertBanner, m.kind);
      playAlertSound();
      vibrate();
      pushAlertHistory(alertHistory, m.kind, m.ts);
    }
  };
  p.onState = (state) => {
    if (state === 'connected') {
      clearTimeout(reconnectTimer);
      setStatus(t('viewer.status.connected'));
    } else if (state === 'disconnected' || state === 'failed') {
      setStatus(t('viewer.status.reconnecting'));
      requestReconnect();
    } else if (state === 'closed') {
      setStatus(t('viewer.status.lost'));
    }
  };
  return p;
}

let collector = createChunkCollector();

async function applyOfferText(raw: string): Promise<void> {
  const text = raw.trim();
  const room = decodeRoom(text);
  if (room) {
    roomInput.value = room;
    await joinRoom();
    return;
  }
  offerInput.value = text;
  await applyOffer();
}

const scanner = new QrScanner('qr-reader', (text) => {
  const room = decodeRoom(text);
  if (room) {
    void scanner.stop();
    qrReader.hidden = true;
    void applyOfferText(text);
    return;
  }
  const full = collector.add(text) ?? (text.startsWith('BCAM1:') ? text : null);
  if (!full) return;
  void scanner.stop();
  qrReader.hidden = true;
  void applyOfferText(full);
});

scanBtn.addEventListener('click', () => {
  collector = createChunkCollector();
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
  peer = makePeer([]);
  addDiagLog(diagLog, 'offre reçue (QR), génération de la réponse…');
  try {
    const answer = await peer.acceptOffer(msg);
    const slim = { ...answer, sdp: mungeSdpAggressive(answer.sdp ?? '', videoMimeFromSdp(msg.sdp ?? '')) };
    const message = encodeMessage(slim);
    answerPayload.value = message;
    qrBoxAnswer.hidden = false;
    answerCarousel?.stop();
    answerCarousel = new QrCarousel(qrCanvasAnswer, qrPosAnswer, toQrChunks(message));
    await answerCarousel.start();
  } catch (err) {
    setStatus(String(err));
    addDiagLog(diagLog, `erreur offre: ${String(err)}`);
  }
}

applyOfferBtn.addEventListener('click', () => void applyOfferText(offerInput.value));

async function joinRoom(): Promise<void> {
  if (!relayParam) {
    setStatus(t('camera.relayNeeded'));
    return;
  }
  const room = roomInput.value.trim().toUpperCase();
  if (room.length !== 6) {
    setStatus(t('viewer.badRoom'));
    return;
  }
  relay = new RelayClient(relayParam);
  relay.onPresence = (cameras) => {
    cameraList.innerHTML = '';
    for (const cam of cameras) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = cam.name || cam.id;
      btn.addEventListener('click', () => {
        lastCameraFrom = cam.id;
        relay?.request(cam.id);
      });
      li.append(btn);
      cameraList.append(li);
    }
    if (cameras.length === 1) {
      lastCameraFrom = cameras[0].id;
      relay?.request(cameras[0].id);
    }
  };
  relay.onCandidate = (from, cand) => {
    if (from === lastCameraFrom) peer?.addCandidate(cand);
  };
  relay.onSignal = async (from, msg) => {
    const m = msg as SignalMessage;
    if (m.t === 'candidate') {
      if (m.candidate) peer?.addCandidate(m.candidate);
      return;
    }
    if (m.t !== 'offer') return;
    lastCameraFrom = from;
    addDiagLog(diagLog, `offre reçue de ${from.slice(0, 8)}… (salon)`);
    try {
      if (peer && peer.pc && peer.pc.connectionState !== 'closed') {
        const answer = await peer.renegotiate(m);
        relay?.signal(from, answer);
      } else {
        peer = makePeer(iceServersFromLocation(), true);
        const answer = await peer.acceptOffer(m);
        relay?.signal(from, answer);
      }
    } catch (err) {
      setStatus(String(err));
      addDiagLog(diagLog, `erreur signal salon: ${String(err)}`);
    }
  };
  try {
    await relay.connect(room, 'viewer', viewerName.value.trim() || 'Viewer', { autoReconnect: true });
  } catch (err) {
    setStatus(String(err));
    addDiagLog(diagLog, `erreur join salon: ${String(err)}`);
    return;
  }
  setStatus(t('viewer.status.joined'));
  addDiagLog(diagLog, `salon rejoint: ${room}`);
}

joinRoomBtn.addEventListener('click', () => void joinRoom());

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
    getDataLog: () => dataLog,
    getRemoteSdp: () => peer?.pc?.remoteDescription?.sdp ?? null,
  };
}
