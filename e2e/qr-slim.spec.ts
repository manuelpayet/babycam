import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { decodeMessage, toQrChunks } from '../src/shared/signaling';
import { shot } from './helpers';
import { pairViaPaste, startCamera } from './pairing-helper';

async function decodeCanvas(page: import('@playwright/test').Page, selector: string): Promise<string | null> {
  const pixels = await page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(img.data), width: img.width, height: img.height };
  }, selector);
  const result = jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  return result?.data ?? null;
}

test('I3.4 QR offre allégé : 1 seul QR décodable, SDP sans ssrc/extmap, candidats udp host, payload < 1000 car., badge de build', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  await startCamera(cam);
  const prev = await cam.locator('#offer-payload').inputValue().catch(() => '');
  await cam.click('#pair-btn');
  await cam.waitForFunction(
    (p) => {
      const el = document.querySelector<HTMLTextAreaElement>('#offer-payload');
      return !!el && el.value.startsWith('BCAM1:') && el.value !== p;
    },
    prev,
    { timeout: 30_000 },
  );
  const payload = await cam.locator('#offer-payload').inputValue();
  expect(payload.length).toBeLessThan(1000);

  const chunks = toQrChunks(payload);
  expect(chunks.length).toBe(1);
  const qrText = await decodeCanvas(cam, '#qr-canvas');
  expect(qrText).toBe(chunks[0]);

  const msg = decodeMessage(payload);
  const lines = msg.sdp.split('\r\n');
  expect(lines.find((l) => l.startsWith('m=video'))!.split(' ').slice(3)).toHaveLength(1);
  expect(lines.find((l) => l.startsWith('m=audio'))!.split(' ').slice(3)).toHaveLength(1);
  expect(msg.sdp).toContain('opus');
  expect(msg.sdp).not.toContain('a=extmap:');
  expect(msg.sdp).not.toContain('a=ssrc');
  expect(msg.sdp).not.toContain('a=msid');
  const cands = lines.filter((l) => l.startsWith('a=candidate:'));
  expect(cands.length).toBeGreaterThan(0);
  for (const c of cands) {
    expect(c).toMatch(/\sudp\s/);
    expect(c).toContain('typ host');
  }

  await expect(cam.locator('#build-badge')).toHaveText(/^v[0-9a-f]{7,}$/);
  await shot(cam, 'I3.4-camera-qr-slim');
  await camCtx.close();
});

test('I3.4 appairage complet avec SDP allégé (offre + réponse) : flux A/V OK', async ({ browser }) => {
  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();
  await startCamera(cam);
  await pairViaPaste(cam, view);

  const answer = await view.locator('#answer-payload').inputValue();
  expect(answer.length).toBeLessThan(1000);
  const amsg = decodeMessage(answer);
  expect(amsg.sdp).not.toContain('a=ssrc');
  expect(amsg.sdp).not.toContain('a=extmap:');

  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await expect(cam.locator('#viewers li')).toContainText('Viewer');
  await expect(view.locator('#status')).toContainText(/Connecté|Connected/i);
  const kinds = await view.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('#remote')!;
    return (video.srcObject as MediaStream).getTracks().map((track) => track.kind).sort();
  });
  expect(kinds).toEqual(['audio', 'video']);

  await shot(cam, 'I3.4-camera-paired');
  await shot(view, 'I3.4-viewer-stream');
  await camCtx.close();
  await viewCtx.close();
});
