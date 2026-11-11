import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeConfig, normalizePath, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import base from './vite.config.ts';

/** One mutation of `tools/mutations.json`: a pattern of a file, replaced as the file is loaded. */
interface Mutation {
  fichier: string;
  motif: string;
  par: string;
}

// `npm run mutations` (tools/mutations.mjs) runs this config once per MUTATION: no file is ever written.
const nom = process.env['MUTATION'];
const table = JSON.parse(readFileSync('tools/mutations.json', 'utf8')) as Record<string, Mutation>;
const m = nom ? table[nom] : undefined;
if (nom && !m) throw new Error(`Mutation inconnue : ${nom}.`);

const muter = (m: Mutation): Plugin => {
  const cible = normalizePath(resolve(m.fichier));
  return {
    name: 'mutation',
    enforce: 'pre', // the source as written, before TypeScript is stripped
    transform(code, id) {
      if (id.split('?')[0] !== cible) return;
      if (!code.includes(m.motif)) throw new Error(`${nom} : motif absent de ${m.fichier}.`);
      return code.replace(m.motif, () => m.par);
    },
  };
};

// No module cache on disk: its key does not see which mutation the plugin applies, one run would load another's.
export default defineConfig((env) =>
  mergeConfig(base(env), { plugins: m ? [muter(m)] : [], test: { fsModuleCache: false } }),
);
