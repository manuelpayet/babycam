import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';
import { decodeRoom, type SignalMessage } from '../../shared/signaling';
import { QrScanner } from '../../shared/scanner';
import { qs, setBuildBadge, Wizard, goView, initHashViews } from '../../shared/ui';
import { registerPwa } from '../../shared/pwa';
import { iceServersFromLocation, ViewerPeer, type DataMessage } from '../../shared/webrtc';
import { thresholdToDbfs } from '../../shared/detection/noise';
import { playAlertSound, pushAlertHistory, showAlertBanner, vibrate } from '../../shared/alerts';
import { RelayClient, relayUrlFromLocation, type PresenceCamera } from '../../shared/relay';
import { addDiagLog, candidateAddress } from '../../shared/diag';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);
registerPwa();
setBuildBadge();
initHashViews(true);

const status = qs<HTMLParagraphElement>('#status');
const videos = qs<HTMLDivElement>('#videos');
const unmuteBtn = qs<HTMLButtonElement>('#unmute-btn');
const fullscreenBtn = qs<HTMLButtonElement>('#fullscreen-btn');
const scanBtn = qs<HTMLButtonElement>('#scan-offer-btn');
const qrReader = qs<HTMLDivElement>('#qr-reader');
const viewerName = qs<HTMLInputElement>('#viewer-name');
const alertBanner = qs<HTMLDivElement>('#alert-banner');
const alertHistory = qs<HTMLUListElement>('#alert-history');
const roomInput = qs<HTMLInputElement>('#room-input');
const joinRoomBtn = qs<HTMLButtonElement>('#join-room-btn');
const cameraList = qs<HTMLUListElement>('#camera-list');
const noiseThreshold = qs<HTMLInputElement>('#noise-threshold');
const motionSens = qs<HTMLInputElement>('#motion-sens');
const noiseMeter = qs<HTMLDivElement>('#noise-meter');
const noiseDbfs = qs<HTMLSpanElement>('#noise-dbfs');
const NOISE_KEY = 'babycam.noiseThreshold';
const MOTION_KEY = 'babycam.motionSens';
noiseThreshold.value = localStorage.getItem(NOISE_KEY) ?? '70';
motionSens.value = localStorage.getItem(MOTION_KEY) ?? '50';
let lastDbfs: number | null = null;

// Multi-caméras : une session par caméra surveillée, un relais par salon rejoint.
interface CamSession {
  id: string;
  room: string;
  name: string;
  relay: RelayClient;
  peer: ViewerPeer;
  video: HTMLVideoElement;
  tile: HTMLElement;
  label: HTMLSpanElement;
  leaving: boolean;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}
const relays = new Map<string, RelayClient>();
const presenceByRoom = new Map<string, PresenceCamera[]>();
const cams = new Map<string, CamSession>();
const pendingRequests = new Set<string>();
const dataLog: DataMessage[] = [];
const relayParam = relayUrlFromLocation();

function sendSettingsTo(p: ViewerPeer): void {
  p.send({
    type: 'settings',
    noiseThreshold: Number(noiseThreshold.value),
    motionSens: Number(motionSens.value),
  });
}

function sendSettings(): void {
  for (const s of cams.values()) sendSettingsTo(s.peer);
}

noiseThreshold.addEventListener('input', () => {
  localStorage.setItem(NOISE_KEY, noiseThreshold.value);
  sendSettings();
});

motionSens.addEventListener('input', () => {
  localStorage.setItem(MOTION_KEY, motionSens.value);
  sendSettings();
});

function updateNoiseMeter(dbfs: number): void {
  lastDbfs = dbfs;
  const pct = Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
  noiseMeter.style.width = `${pct}%`;
  noiseMeter.classList.toggle('hot', dbfs > thresholdToDbfs(Number(noiseThreshold.value)));
  noiseDbfs.textContent = `${Math.round(dbfs)} dBFS`;
}

// Wizard d'appairage (100 % relais) : étapes 0=code de salon, 1=connexion.
const pairWizard = new Wizard(qs<HTMLElement>('#pairing'));
const waitingText = qs<HTMLParagraphElement>('#wiz-waiting-text');
pairWizard.show(0);

function setStatus(text: string): void {
  status.textContent = text;
}

function requestReconnect(camId: string): void {
  const s = cams.get(camId);
  if (!s) return;
  clearTimeout(s.reconnectTimer);
  s.reconnectTimer = setTimeout(() => {
    if (s.peer.pc?.connectionState !== 'connected') s.relay.request(camId);
  }, 3000);
}

const diagRelay = qs<HTMLParagraphElement>('#diag-relay');
const diagPeers = qs<HTMLUListElement>('#diag-peers');
const diagLog = qs<HTMLUListElement>('#diag-log');

function renderDiag(): void {
  const open = [...relays.values()].filter((r) => r.wsState === 1).length;
  diagRelay.textContent = `relais ${relayParam ?? 'non configuré'} — ws=${open}/${relays.size} — rooms=[${[...relays.keys()].join(', ')}] — cameras=${cams.size}`;
  diagPeers.innerHTML = '';
  for (const s of cams.values()) {
    const pc = s.peer.pc;
    if (pc) {
      const li = document.createElement('li');
      li.textContent = `${s.name} (${s.room}) [${pc.connectionState}/${pc.iceConnectionState}/${pc.iceGatheringState}/${pc.signalingState}] local: ${s.peer.localCandidates.map(candidateAddress).join(', ') || '…'} | remote: ${s.peer.remoteCandidates.map(candidateAddress).join(', ') || '…'}`;
      diagPeers.append(li);
    }
  }
}
setInterval(renderDiag, 1000);

function updateTileLabel(s: CamSession, state: string): void {
  s.label.textContent = `${s.name} · ${s.room} (${state})`;
}

function makePeer(camId: string, session: CamSession): ViewerPeer {
  const p = new ViewerPeer(iceServersFromLocation(), viewerName.value.trim() || 'Viewer');
  p.onCandidate = (cand) => session.relay.candidate(camId, cand);
  p.onTrack = (s) => {
    session.video.srcObject = s;
    session.video.muted = true;
    void session.video.play().catch(() => undefined);
  };
  p.onData = (m) => {
    dataLog.push(m);
    if (m.type === 'alert') {
      showAlertBanner(alertBanner, m.kind);
      playAlertSound();
      vibrate();
      pushAlertHistory(alertHistory, m.kind, m.ts, session.name);
    } else if (m.type === 'level') {
      updateNoiseMeter(m.dbfs);
    }
  };
  p.onOpen = () => sendSettingsTo(p);
  p.onState = (state) => {
    updateTileLabel(session, state);
    if (state === 'connected') {
      clearTimeout(session.reconnectTimer);
      waitingText.textContent = t('viewer.status.connected');
      pairWizard.show(pairWizard.count);
      goView('main');
      setStatus(`${t('viewer.status.connected')} (${cams.size})`);
    } else if (state === 'disconnected' || state === 'failed') {
      waitingText.textContent = t('viewer.status.reconnecting');
      pairWizard.show(1);
      setStatus(t('viewer.status.reconnecting'));
      requestReconnect(camId);
    } else if (state === 'closed') {
      if (session.leaving) return;
      dropSession(camId);
      setStatus(t('viewer.status.lost'));
    }
  };
  return p;
}

function createSession(camId: string, relay: RelayClient, room: string): CamSession {
  const info = presenceByRoom.get(room)?.find((c) => c.id === camId);
  const name = info?.name || camId.slice(0, 8);
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.cam = camId;
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  // Compat : la première tuile garde l'id #remote (1 caméra = comportement historique).
  if (!videos.querySelector('video')) video.id = 'remote';
  const bar = document.createElement('div');
  bar.className = 'tile-bar';
  const label = document.createElement('span');
  label.className = 'tile-state';
  const leaveBtn = document.createElement('button');
  leaveBtn.className = 'btn btn-small';
  leaveBtn.textContent = t('viewer.leaveCam');
  bar.append(label, leaveBtn);
  tile.append(video, bar);
  videos.append(tile);

  const session: CamSession = {
    id: camId,
    room,
    name,
    relay,
    peer: null as unknown as ViewerPeer,
    video,
    tile,
    label,
    leaving: false,
  };
  leaveBtn.addEventListener('click', () => leaveCam(camId));
  session.peer = makePeer(camId, session);
  cams.set(camId, session);
  updateTileLabel(session, 'connecting');
  return session;
}

function dropSession(camId: string): void {
  const s = cams.get(camId);
  if (!s) return;
  clearTimeout(s.reconnectTimer);
  cams.delete(camId);
  s.tile.remove();
  renderCameraList();
}

function leaveCam(camId: string): void {
  const s = cams.get(camId);
  if (!s) return;
  s.leaving = true;
  s.peer.close();
  dropSession(camId);
  if (cams.size === 0) setStatus(t('viewer.status.idle'));
}

function renderCameraList(): void {
  cameraList.innerHTML = '';
  for (const [room, list] of presenceByRoom) {
    const relay = relays.get(room);
    if (!relay) continue;
    for (const cam of list) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'btn';
      const connected = cams.has(cam.id);
      btn.textContent = `${cam.name || cam.id.slice(0, 8)} · ${room}${connected ? ' ✓' : ''}`;
      btn.disabled = connected;
      btn.addEventListener('click', () => requestCam(cam.id, relay));
      li.append(btn);
      cameraList.append(li);
    }
  }
}

function requestCam(camId: string, relay: RelayClient): void {
  if (cams.has(camId) || pendingRequests.has(camId)) return;
  pendingRequests.add(camId);
  setTimeout(() => pendingRequests.delete(camId), 10_000);
  relay.request(camId);
}

// Le seul payload QR scanné est le code de salon (BCAM1/R/CODE) affiché par la caméra.
const scanner = new QrScanner('qr-reader', (text) => {
  const room = decodeRoom(text);
  if (!room) return;
  void scanner.stop();
  qrReader.hidden = true;
  roomInput.value = room;
  void joinRoom();
});

scanBtn.addEventListener('click', () => {
  qrReader.hidden = false;
  scanner.start('environment').catch((err: unknown) => setStatus(String(err)));
});

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
  if (relays.has(room)) {
    setStatus(t('viewer.status.joined'));
    return;
  }
  const relay = new RelayClient(relayParam);
  relays.set(room, relay);
  relay.onPresence = (cameras) => {
    presenceByRoom.set(room, cameras);
    renderCameraList();
    if (cameras.length === 1) requestCam(cameras[0].id, relay);
  };
  relay.onCandidate = (from, cand) => {
    cams.get(from)?.peer.addCandidate(cand);
  };
  relay.onSignal = async (from, msg) => {
    const m = msg as SignalMessage;
    if (m.t === 'candidate') {
      if (m.candidate) cams.get(from)?.peer.addCandidate(m.candidate);
      return;
    }
    if (m.t !== 'offer') return;
    pendingRequests.delete(from);
    addDiagLog(diagLog, `offre reçue de ${from.slice(0, 8)}… (salon ${room})`);
    try {
      const existing = cams.get(from);
      if (existing && existing.peer.pc && existing.peer.pc.connectionState !== 'closed') {
        const answer = await existing.peer.renegotiate(m);
        relay.signal(from, answer);
      } else {
        if (existing) dropSession(from);
        const session = createSession(from, relay, room);
        const answer = await session.peer.acceptOffer(m);
        relay.signal(from, answer);
      }
    } catch (err) {
      setStatus(String(err));
      addDiagLog(diagLog, `erreur signal salon: ${String(err)}`);
    }
  };
  try {
    await relay.connect(room, 'viewer', viewerName.value.trim() || 'Viewer', { autoReconnect: true });
  } catch (err) {
    relays.delete(room);
    setStatus(String(err));
    addDiagLog(diagLog, `erreur join salon: ${String(err)}`);
    return;
  }
  pairWizard.show(1);
  waitingText.textContent = t('viewer.wiz.waiting');
  setStatus(t('viewer.status.joined'));
  addDiagLog(diagLog, `salon rejoint: ${room}`);
}

joinRoomBtn.addEventListener('click', () => void joinRoom());

unmuteBtn.addEventListener('click', () => {
  for (const s of cams.values()) {
    s.video.muted = false;
    void s.video.play().catch(() => undefined);
  }
});

fullscreenBtn.addEventListener('click', () => {
  videos.requestFullscreen?.().catch(() => undefined);
});

setStatus(t('viewer.status.idle'));

if (new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__babycam = {
    getPeerState: () => [...cams.values()][0]?.peer.pc?.connectionState ?? null,
    getCams: () =>
      [...cams.values()].map((s) => ({ id: s.id, name: s.name, room: s.room, state: s.peer.pc?.connectionState ?? null })),
    getDataLog: () => dataLog,
    getRemoteSdp: () => [...cams.values()][0]?.peer.pc?.remoteDescription?.sdp ?? null,
    getLastLevel: () => lastDbfs,
  };
}
