import { defineConfig } from 'vite';

/** The probe of the chain, in one script posed before the page: `dist/sonde/sonde.js`. Build it after the page. */
export default defineConfig({
  build: {
    outDir: 'dist/sonde',
    lib: {
      entry: 'src/presence/chaine/sonde-page.ts',
      formats: ['iife'],
      name: 'sonde',
      fileName: () => 'sonde.js',
    },
  },
});
