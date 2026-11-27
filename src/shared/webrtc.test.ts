import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUN_URL,
  DEFAULT_TURN_CREDENTIAL,
  DEFAULT_TURN_URL,
  DEFAULT_TURN_USERNAME,
  hasTurnServer,
  iceServersFromLocation,
  isRelayCandidate,
  turnFailedAfterGathering,
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

describe('hasTurnServer', () => {
  it('détecte turn: et turns: (string ou tableau d’URLs)', () => {
    expect(hasTurnServer([])).toBe(false);
    expect(hasTurnServer([{ urls: 'stun:stun.l.google.com:19302' }])).toBe(false);
    expect(hasTurnServer([{ urls: 'turn:openrelay.metered.ca:80' }])).toBe(true);
    expect(hasTurnServer([{ urls: 'turns:turn.example.com:443' }])).toBe(true);
    expect(hasTurnServer([{ urls: ['stun:x:3478', 'turn:x:3478'] }])).toBe(true);
  });
});

describe('isRelayCandidate', () => {
  it('ne retient que les candidats typ relay', () => {
    expect(isRelayCandidate('candidate:842163049 1 udp 1677729535 203.0.113.7 54400 typ relay raddr 10.0.0.1 rport 54400 generation 0')).toBe(true);
    expect(isRelayCandidate('candidate:1 1 udp 2122260223 192.168.1.2 54400 typ srflx raddr 10.0.0.1 rport 54400')).toBe(false);
    expect(isRelayCandidate('candidate:2 1 udp 41819902 192.168.1.2 54401 typ host')).toBe(false);
  });
});

describe('turnFailedAfterGathering', () => {
  const withTurn: RTCIceServer[] = [{ urls: DEFAULT_TURN_URL, username: 'u', credential: 'p' }];
  const stunOnly: RTCIceServer[] = [{ urls: DEFAULT_STUN_URL }];

  it('TURN configuré + aucun candidat relais après gathering = échec TURN', () => {
    expect(turnFailedAfterGathering(withTurn, false)).toBe(true);
  });

  it('un candidat relais récolté = TURN fonctionnel', () => {
    expect(turnFailedAfterGathering(withTurn, true)).toBe(false);
  });

  it('sans TURN configuré, l’absence de relais n’est pas un échec', () => {
    expect(turnFailedAfterGathering(stunOnly, false)).toBe(false);
    expect(turnFailedAfterGathering([], false)).toBe(false);
  });

  it('la config par défaut (STUN + TURN) est détectée comme ayant un TURN', () => {
    vi.stubGlobal('location', { search: '' });
    const servers = iceServersFromLocation();
    expect(hasTurnServer(servers)).toBe(true);
    expect(turnFailedAfterGathering(servers, false)).toBe(true);
  });
});
