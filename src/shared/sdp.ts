export interface MungeOptions {
  videoMime?: string;
  audioMime?: string;
  dropExtmap?: boolean;
}

function sectionOf(line: string): string {
  return line.slice(2).split(' ')[0];
}

export function mungeSdp(sdp: string, opts: MungeOptions): string {
  const lines = sdp.split('\r\n');
  const kept = new Map<string, Set<number>>();
  let section = '';
  for (const line of lines) {
    if (line.startsWith('m=')) {
      section = sectionOf(line);
      kept.set(section, new Set());
      continue;
    }
    if (!line.startsWith('a=rtpmap:')) continue;
    const m = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(line);
    if (!m) continue;
    const mime = `${section}/${m[2].toLowerCase()}`;
    const want =
      (section === 'video' && opts.videoMime !== undefined && mime === opts.videoMime.toLowerCase()) ||
      (section === 'audio' && opts.audioMime !== undefined && mime === opts.audioMime.toLowerCase());
    if (want) kept.get(section)!.add(Number(m[1]));
  }

  const out: string[] = [];
  section = '';
  for (const line of lines) {
    if (line.startsWith('m=')) {
      section = sectionOf(line);
      const pts = kept.get(section);
      if (pts && pts.size > 0) {
        const parts = line.slice(2).split(' ');
        const header = parts.slice(0, 3).join(' ');
        const keptPts = parts.slice(3).filter((p) => pts.has(Number(p)));
        out.push(`m=${header} ${keptPts.join(' ')}`);
      } else {
        out.push(line);
      }
      continue;
    }
    if (opts.dropExtmap && line.startsWith('a=extmap:')) continue;
    const codecAttr = /^(a=(?:rtpmap|fmtp|rtcp-fb)):(\d+)/.exec(line);
    if (codecAttr) {
      const pts = kept.get(section);
      if (pts && pts.size > 0 && !pts.has(Number(codecAttr[2]))) continue;
    }
    out.push(line);
  }
  return out.join('\r\n');
}

export function filterSdpByVideoCodec(sdp: string, mimeType: string): string {
  return mungeSdp(sdp, { videoMime: mimeType });
}

export function mungeSdpAggressive(sdp: string, videoMime?: string): string {
  return mungeSdp(sdp, { videoMime, audioMime: 'audio/opus', dropExtmap: true });
}
