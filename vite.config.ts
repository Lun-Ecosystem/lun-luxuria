import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

const CORE = process.env.CORE_URL ?? 'http://127.0.0.1:8788';
const VOICE = process.env.VOIX_URL ?? 'http://127.0.0.1:8793';

export default defineConfig({
  plugins: [svelte(), ...(process.env.VITEST ? [svelteTesting()] : [])],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 5180),
    proxy: {
      '/api': { target: CORE, changeOrigin: true },
      '/voix': { target: VOICE, changeOrigin: true, rewrite: (p) => p.replace(/^\/voix/, '') },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    server: { deps: { inline: [/bits-ui/, /@lucide\/svelte/, /svelte-toolbelt/, /runed/] } },
  },
});
