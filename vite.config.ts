import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // .env, then what the shell already set, which wins: `$env:CORE_URL` still works.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const CORE = env.CORE_URL ?? 'http://127.0.0.1:8788';
  const VOICE = env.VOIX_URL ?? 'http://127.0.0.1:8793';
  return {
    plugins: [svelte(), ...(process.env.VITEST ? [svelteTesting()] : [])],
    server: {
      host: '127.0.0.1',
      port: Number(env.PORT ?? 5180),
      proxy: {
        '/api': { target: CORE, changeOrigin: true },
        '/voix': { target: VOICE, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/voix/, '') },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      setupFiles: ['./vitest.setup.ts'],
      server: { deps: { inline: [/bits-ui/, /@lucide\/svelte/, /svelte-toolbelt/, /runed/] } },
    },
  };
});
