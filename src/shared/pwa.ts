export function registerPwa(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    void navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
      .then((reg) => {
        void reg.update().catch(() => undefined);
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!hadController) return;
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      })
      .catch(() => undefined);
  });
}
