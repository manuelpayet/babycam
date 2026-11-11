export function filterSdpByVideoCodec(sdp: string, mimeType: string): string {
  const wanted = mimeType.toLowerCase().replace(/^video\//, '');
  const lines = sdp.split('\r\n');
  const videoPts = new Set<number>();
  let inVideo = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inVideo = line.startsWith('m=video');
      continue;
    }
    if (inVideo && line.startsWith('a=rtpmap:')) {
      const m = /^a=rtpmap:(\d+) ([^/]+)/.exec(line);
      if (m && m[2].toLowerCase() === wanted) videoPts.add(Number(m[1]));
    }
  }
  if (videoPts.size === 0) return sdp;

  const out: string[] = [];
  inVideo = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (line.startsWith('m=video')) {
        const parts = line.slice(2).split(' ');
        const header = parts.slice(0, 3).join(' ');
        const pts = parts.slice(3).filter((p) => videoPts.has(Number(p)));
        out.push(`m=${header} ${pts.join(' ')}`);
        inVideo = true;
      } else {
        out.push(line);
        inVideo = false;
      }
      continue;
    }
    if (inVideo) {
      const codecAttr = /^(a=(?:rtpmap|fmtp|rtcp-fb)):(\d+)/.exec(line);
      if (codecAttr) {
        if (videoPts.has(Number(codecAttr[2]))) out.push(line);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\r\n');
}
