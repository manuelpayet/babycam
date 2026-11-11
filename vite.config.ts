import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/babycam/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'manifest.webmanifest'],
      manifest: false,
      devOptions: { enabled: false },
      workbox: { globPatterns: ['**/*.{js,css,html,png,webmanifest,svg}'] },
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
