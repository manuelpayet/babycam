import { describe, expect, it } from 'vitest';
import { WakeLockManager, type WakeLockLike, type WakeLockSentinelLike } from './wakelock';

function fakeSentinel(): WakeLockSentinelLike {
  const target = new EventTarget();
  const sentinel = {
    released: false,
    async release() {
      sentinel.released = true;
      target.dispatchEvent(new Event('release'));
    },
  };
  return Object.assign(target, sentinel) as WakeLockSentinelLike;
}

function fakeWakeLock(): { wl: WakeLockLike; state: { calls: number } } {
  const state = { calls: 0 };
  const wl: WakeLockLike = {
    async request() {
      state.calls++;
      return fakeSentinel();
    },
  };
  return { wl, state };
}

describe('WakeLockManager', () => {
  it('demande et libère le wake lock', async () => {
    const { wl, state } = fakeWakeLock();
    const mgr = new WakeLockManager(() => wl);
    const events: boolean[] = [];
    mgr.onChange = (a) => events.push(a);

    expect(mgr.active).toBe(false);
    expect(await mgr.request()).toBe(true);
    expect(mgr.active).toBe(true);
    expect(state.calls).toBe(1);
    expect(events).toEqual([true]);

    await mgr.release();
    expect(mgr.active).toBe(false);
    expect(events).toEqual([true, false]);
  });

  it('retourne false si l API est absente', async () => {
    const mgr = new WakeLockManager(() => undefined);
    expect(await mgr.request()).toBe(false);
    expect(mgr.active).toBe(false);
  });

  it('re-demande au retour en visibilité seulement si voulu', async () => {
    const { wl, state } = fakeWakeLock();
    const mgr = new WakeLockManager(() => wl);
    await mgr.onVisible();
    expect(state.calls).toBe(0);
    await mgr.request();
    await mgr.onVisible();
    expect(state.calls).toBe(2);
    await mgr.release();
    await mgr.onVisible();
    expect(state.calls).toBe(2);
  });
});
