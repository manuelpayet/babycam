import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { WebSocketServer, type WebSocket } from 'ws';
import { shot } from './helpers';

interface RelayClientInfo {
  id: string;
  role: string;
  name: string;
}

function startMockRelay(): Promise<{ wss: WebSocketServer; url: string }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const clients = new Map<WebSocket, RelayClientInfo>();
    const broadcast = () => {
      const cameras = [...clients.values()]
        .filter((c) => c.role === 'camera')
        .map((c) => ({ id: c.id, name: c.name, ts: Date.now() }));
      const text = JSON.stringify({ type: 'presence', cameras });
      for (const sock of clients.keys()) sock.send(text);
    };
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const m = JSON.parse(data.toString()) as Record<string, unknown>;
        const c = clients.get(ws);
        if (m.type === 'join') {
          const client: RelayClientInfo = { id: crypto.randomUUID(), role: m.role as string, name: String(m.name) };
          clients.set(ws, client);
          ws.send(JSON.stringify({ type: 'welcome', id: client.id }));
          broadcast();
        } else if (c && ['request', 'signal', 'candidate'].includes(m.type as string)) {
          for (const [sock, cl] of clients) {
            if (cl.id === m.to) sock.send(JSON.stringify({ ...m, from: c.id }));
          }
        }
      });
      ws.on('close', () => {
        clients.delete(ws);
        broadcast();
      });
    });
    wss.on('listening', () => {
      const addr = wss.address() as AddressInfo;
      resolve({ wss, url: `ws://127.0.0.1:${addr.port}` });
    });
  });
}

test('découverte par salon : la caméra publie sa présence, le viewer rejoint et reçoit le flux', async ({ browser }) => {
  const { wss, url } = await startMockRelay();
  const relayParam = encodeURIComponent(url);

  const camCtx = await browser.newContext();
  const viewCtx = await browser.newContext();
  const cam = await camCtx.newPage();
  const view = await viewCtx.newPage();

  await cam.goto(`camera.html?stun=0&debug=1&relay=${relayParam}`);
  await cam.click('#start-btn');
  await cam.waitForFunction(() => {
    const video = document.querySelector<HTMLVideoElement>('#preview');
    return !!video && !!video.srcObject && video.readyState >= 2;
  });
  await cam.click('#create-room-btn');
  await expect(cam.locator('#room-code')).not.toBeHidden();
  const room = (await cam.locator('#room-code').textContent())!.trim();
  expect(room).toHaveLength(6);

  await view.goto(`viewer.html?stun=0&debug=1&relay=${relayParam}`);
  await view.fill('#room-input', room);
  await view.click('#join-room-btn');
  await expect(view.locator('#camera-list button')).toHaveCount(1);
  await shot(view, 'I2.4-viewer-room-list');

  await view.locator('#camera-list button').first().click();
  await view.waitForFunction(
    () => {
      const video = document.querySelector<HTMLVideoElement>('#remote');
      return !!video && !!video.srcObject && video.readyState >= 2;
    },
    null,
    { timeout: 30_000 },
  );
  await expect(cam.locator('#viewers li')).toHaveCount(1);
  await shot(cam, 'I2.4-camera-room');
  await shot(view, 'I2.4-viewer-discovered');

  await camCtx.close();
  await viewCtx.close();
  wss.close();
});
