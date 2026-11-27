// Identité cryptographique de l'appareil : paire ECDSA P-256 générée à l'appairage,
// clé privée persistée en localStorage (remplace l'ancien deviceId copiable), clé
// publique transmise au relais au `join` puis stockée côté caméra dans le relais.
import { exportPrivateKeyJwk, exportPublicKeyB64, generateDeviceKeyPair, importPrivateKeyJwk } from './device-auth';

const STORAGE_KEY = 'babycam.deviceKey.v1';

export interface DeviceIdentity {
  privateKey: CryptoKey;
  pubkey: string;
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { jwk?: JsonWebKey; pubkey?: string };
      if (parsed.jwk && parsed.pubkey) {
        const privateKey = await importPrivateKeyJwk(parsed.jwk);
        return { privateKey, pubkey: parsed.pubkey };
      }
    }
  } catch {
    // stockage illisible : on regénère une identité éphémère
  }
  const pair = await generateDeviceKeyPair();
  const jwk = await exportPrivateKeyJwk(pair.privateKey);
  const pubkey = await exportPublicKeyB64(pair.publicKey);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ jwk, pubkey }));
  } catch {
    // localStorage indisponible (navigation privée) : identité éphémère, l'appairage
    // fonctionnera mais sans ré-approbation automatique.
  }
  return { privateKey: pair.privateKey, pubkey };
}
