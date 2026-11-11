import '../../shared/style.css';
import { applyTranslations, initLangSelect, t } from '../../shared/i18n';

applyTranslations();
const langSelect = document.querySelector<HTMLSelectElement>('#lang-select');
if (langSelect) initLangSelect(langSelect);

const preview = document.querySelector<HTMLVideoElement>('#preview')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn')!;
const stopBtn = document.querySelector<HTMLButtonElement>('#stop-btn')!;
const switchBtn = document.querySelector<HTMLButtonElement>('#switch-cam')!;
const torchBtn = document.querySelector<HTMLButtonElement>('#torch-btn')!;

let stream: MediaStream | null = null;
let facing: 'environment' | 'user' = 'environment';

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
  setStatusKey('camera.status.running');
  startBtn.disabled = true;
  stopBtn.disabled = false;
}

function stop(): void {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  preview.srcObject = null;
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

if (new URLSearchParams(location.search).get('debug') === '1') {
  (window as unknown as Record<string, unknown>).__babycam = {
    getStream: () => stream,
  };
}
