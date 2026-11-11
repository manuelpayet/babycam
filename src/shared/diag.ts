export function candidateAddress(cand: string): string {
  const m = /\s(\S+)\s(\d+)\styp\s(\w+)/.exec(cand);
  return m ? `${m[1]}:${m[2]} (${m[3]})` : cand.slice(0, 48);
}

export function addDiagLog(ul: HTMLElement, msg: string): void {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  ul.prepend(li);
  while (ul.children.length > 30) ul.lastElementChild?.remove();
}
