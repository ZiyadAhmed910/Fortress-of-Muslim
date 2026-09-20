import { defineConfig } from 'vitest/config';

// The PWA is plain ES modules with no build step, so tests import the shipped files directly --
// what runs in the browser is exactly what is under test. happy-dom covers the modules that touch
// document; the pure ones (prayer-times, categories) need no environment at all.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.js'],
  },
});
