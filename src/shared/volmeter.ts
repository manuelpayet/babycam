export function dbfsToPercent(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.min(100, Math.max(0, ((dbfs + 60) / 60) * 100));
}

export function updateVolMeter(fill: HTMLElement, dbfs: number, label?: HTMLElement): void {
  fill.style.width = `${dbfsToPercent(dbfs)}%`;
  if (label) label.textContent = Number.isFinite(dbfs) ? `${Math.round(dbfs)} dB` : '−∞ dB';
}
