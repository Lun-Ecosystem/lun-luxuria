// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|svelte|css|html)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe('public front', () => {
  it('names no instance of the agent, nor what it may be linked to', () => {
    const files = [...sources(src), fileURLToPath(new URL('../index.html', import.meta.url))];
    expect(files.length).toBeGreaterThan(20);
    // `animation` (CSS) and requestAnimationFrame are not the name.
    const offenders = files.filter((f) => /anima(?![a-z])|natsume/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never shows the word "core" in the displayed text', () => {
    // The markup only: code and comments may name it.
    const shown = (t: string) =>
      t
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const offenders = sources(src).filter(
      (f) => f.endsWith('.svelte') && /\bcore\b/i.test(shown(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('no em dash in what is displayed', () => {
    const strip = (t: string) =>
      t
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/(^|[^:'"`\w])\/\/[^\n]*/g, '$1');
    const offenders = sources(src).filter((f) => strip(readFileSync(f, 'utf8')).includes('—'));
    expect(offenders).toEqual([]);
  });
});
