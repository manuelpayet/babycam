// Génère une paire de clés VAPID (P-256) pour les notifications push :
// - clé publique (base64url, point non compressé 65 octets) → à embarquer dans
//   `src/shared/push.ts` (VAPID_PUBLIC_KEY) et dans `relay/wrangler.toml` [vars]
// - clé privée (base64url, scalaire 32 octets) → secret du worker :
//   `cd relay && npx wrangler secret put VAPID_PRIVATE_KEY`
// Usage : npm run vapid
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });
const b64url = (s) => Buffer.from(s, 'base64url');
const publicKeyB64url = Buffer.concat([Buffer.from([0x04]), b64url(pubJwk.x), b64url(pubJwk.y)]).toString('base64url');
const privateKeyB64url = b64url(privJwk.d).toString('base64url');

console.log('VAPID_PUBLIC_KEY  (à mettre dans src/shared/push.ts et relay/wrangler.toml) :');
console.log(`  ${publicKeyB64url}`);
console.log('VAPID_PRIVATE_KEY (secret du worker, NE PAS COMMITTER en clair) :');
console.log(`  ${privateKeyB64url}`);
console.log('\nCommande : cd relay && npx wrangler secret put VAPID_PRIVATE_KEY');
