// Signalisation : le SDP (offer/answer/candidate) transite par le relais WebSocket
// (relay.ts), jamais par QR. Le seul payload QR restant est le code de salon.

export interface SignalMessage {
  v: 1;
  t: 'offer' | 'answer' | 'candidate';
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export function encodeRoom(room: string): string {
  return `BCAM1/R/${room}`;
}

export function decodeRoom(text: string): string | null {
  const m = /^BCAM1\/R\/([A-Z2-9]{6})$/.exec(text.trim());
  return m ? m[1] : null;
}
