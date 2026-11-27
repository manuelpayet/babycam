import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUN_URL,
  DEFAULT_TURN_CREDENTIAL,
  DEFAULT_TURN_URL,
  DEFAULT_TURN_USERNAME,
  iceServersFromLocation,
} from './webrtc';

describe('iceServersFromLocation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('par défaut : STUN public + TURN de secours (fallback NAT symétrique)', () => {
    vi.stubGlobal('location', { search: '' });
    const servers = iceServersFromLocation();
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ urls: DEFAULT_STUN_URL });
    expect(servers[1].urls).toBe(DEFAULT_TURN_URL);
    expect(String(servers[1].urls)).toMatch(/^turn:/);
    expect(servers[1].username).toBe(DEFAULT_TURN_USERNAME);
    expect(servers[1].credential).toBe(DEFAULT_TURN_CREDENTIAL);
  });

  it('?stun=0 : aucun serveur ICE (mode QR local, comportement historique préservé)', () => {
    vi.stubGlobal('location', { search: '?stun=0' });
    expect(iceServersFromLocation()).toEqual([]);
  });

  it('?turn=0 : STUN seul, le TURN est désactivé', () => {
    vi.stubGlobal('location', { search: '?turn=0' });
    expect(iceServersFromLocation()).toEqual([{ urls: DEFAULT_STUN_URL }]);
  });

  it('?stun=0&turn=0 : aucun serveur ICE', () => {
    vi.stubGlobal('location', { search: '?stun=0&turn=0' });
    expect(iceServersFromLocation()).toEqual([]);
  });

  it('?turn=<url> : TURN personnalisé, sans les identifiants par défaut', () => {
    vi.stubGlobal('location', { search: `?turn=${encodeURIComponent('turn:turn.example.com:3478')}` });
    const servers = iceServersFromLocation();
    expect(servers).toHaveLength(2);
    expect(servers[1]).toEqual({ urls: 'turn:turn.example.com:3478' });
  });

  it('?turn=<url>&turnuser=…&turnpass=… : identifiants TURN personnalisés', () => {
    const search = `?turn=${encodeURIComponent('turns:turn.example.com:443')}&turnuser=alice&turnpass=s3cret`;
    vi.stubGlobal('location', { search });
    const servers = iceServersFromLocation();
    expect(servers[1]).toEqual({ urls: 'turns:turn.example.com:443', username: 'alice', credential: 's3cret' });
  });

  it('?turnuser=…&turnpass=… seuls : appliqués au TURN par défaut', () => {
    vi.stubGlobal('location', { search: '?turnuser=bob&turnpass=pw' });
    const servers = iceServersFromLocation();
    expect(servers[1]).toEqual({ urls: DEFAULT_TURN_URL, username: 'bob', credential: 'pw' });
  });
});
