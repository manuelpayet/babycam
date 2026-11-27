import { expect, test } from '@playwright/test';
import { createRoom, joinRoomAndConnect, startCamera } from './pairing-helper';
import { shot } from './helpers';
import { killMockRelay, startMockRelay } from './mock-relay';

interface MicState {
  hasMic: boolean;
  enabled: boolean | null;
  talkTrackAdded: boolean;
  talking: boolean;
}

interface TalkTrackInfo {
  kind: string;
  readyState: string;
  enabled: boolean;
}

declare global {
  interface Window {
    __babycam?: Record<string, unknown>;
  }
}

test('talkie-walkie : muet/unmute côté viewer, second track audio reçu et diffusé côté caméra', async ({ browser }) => {
  const relay = await startMockRelay();
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await startCamera(cam, relay.url);
  const room = await createRoom(cam);
  await joinRoomAndConnect(view, relay.url, room);

  // Avant appui : aucun track talk côté caméra, micro du viewer muet.
  const before = await cam.evaluate(() => (window.__babycam?.getTalkTracks as () => TalkTrackInfo[])());
  expect(before).toEqual([]);
  const micBefore = await view.evaluate(() => (window.__babycam?.getMicState as () => MicState)());
  expect(micBefore.hasMic).toBe(false);

  // Unmute : un clic sur le bouton active le micro du viewer.
  await view.click('#talk-btn');
  await view.waitForFunction(
    () => {
      const s = (window.__babycam?.getMicState as () => MicState)();
      return s.hasMic && s.talkTrackAdded && s.enabled === true && s.talking;
    },
    null,
    { timeout: 30_000 },
  );
  await expect(view.locator('#talk-btn')).toHaveClass(/talking/);

  // La caméra a reçu le second track audio (viewer→caméra) après renégociation via le relais.
  await cam.waitForFunction(
    () => {
      const tracks = (window.__babycam?.getTalkTracks as () => TalkTrackInfo[])();
      return tracks.length === 1 && tracks[0].kind === 'audio' && tracks[0].readyState === 'live';
    },
    null,
    { timeout: 30_000 },
  );

  // L'élément audio de diffusion (haut-parleur, non muted) est alimenté ; l'indicateur talk est visible.
  const audioOk = await cam.evaluate(() => (window.__babycam?.getTalkAudioStream as () => boolean)());
  expect(audioOk).toBe(true);
  await expect(cam.locator('#talk-indicator')).toBeVisible();

  // Bouton geste utilisateur côté caméra (autoplay iOS) : play() dans le clic → lecture lancée.
  await cam.click('#talk-sound-btn');
  await cam.waitForFunction(() => (window.__babycam?.getTalkAudioPaused as () => boolean)() === false, null, { timeout: 10_000 });
  await expect(cam.locator('#talk-sound-btn')).toBeDisabled();

  await shot(view, 'I8.1-viewer-talking');
  await shot(cam, 'I8.1-camera-talking');

  // Mute : un second clic coupe le micro et l'indicateur retombe côté caméra.
  await view.click('#talk-btn');
  await view.waitForFunction(
    () => {
      const s = (window.__babycam?.getMicState as () => MicState)();
      return s.enabled === false && !s.talking;
    },
    null,
    { timeout: 10_000 },
  );
  await expect(view.locator('#talk-btn')).not.toHaveClass(/talking/);
  await expect(cam.locator('#talk-indicator')).toBeHidden();

  // Le flux caméra→viewer n'est pas cassé : la vidéo distante est toujours lue.
  const videoOk = await view.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('#remote');
    return !!v && !!v.srcObject && v.readyState >= 2;
  });
  expect(videoOk).toBe(true);

  await camCtx.close();
  await viewCtx.close();
  await killMockRelay(relay);
});
