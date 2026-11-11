import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return new Date().toISOString();
  }
}

export default defineConfig({
  base: '/babycam/',
  define: { __BABYCAM_BUILD__: JSON.stringify(buildId()) },
  plugins: [
    VitePWA({
      injectRegister: false,
      includeAssets: ['icons/*.png', 'manifest.webmanifest'],
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest,svg}'],
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        camera: fileURLToPath(new URL('./camera.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
      },
    },
  },
  test: {
    passWithNoTests: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
