/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Self-contained sales demonstration. Reuses the repository's installed
// dependencies; it is not part of the English-learning app build.
export default defineConfig({
  root: decodeURIComponent(new URL('.', import.meta.url).pathname),
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
