import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/babycam/',
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
