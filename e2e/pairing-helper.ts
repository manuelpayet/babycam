import type { Page } from '@playwright/test';
import { relayParams } from './helpers';

export async function startCamera(cam: Page, relayUrl: string): Promise<void> {
  await cam.goto('camera.html' + relayParams(relayUrl));
  await cam.click('#start-btn');
  await cam.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
}

// Ouvre la page d'appairage #/pair et crée le salon : retourne le code de salon.
export async function createRoom(cam: Page): Promise<string> {
  await cam.click('#pair-btn');
  await cam.waitForSelector('#room-code:not([hidden])');
  return (await cam.locator('#room-code').textContent())!.trim();
}

export async function joinRoomAndConnect(view: Page, relayUrl: string, room: string): Promise<void> {
  await view.goto('viewer.html' + relayParams(relayUrl));
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );
}

export async function pairViaRoom(cam: Page, view: Page, relayUrl: string): Promise<void> {
  const room = await createRoom(cam);
  await joinRoomAndConnect(view, relayUrl, room);
}
