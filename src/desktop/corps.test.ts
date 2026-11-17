import { describe, expect, it } from 'vitest';
import { BREATH, loadBody, readBodyFile, type Call } from './corps.svelte.ts';

const folderWith =
  (files: Record<string, string | Error>): Call =>
  async (command, args) => {
    // The window keeps the folder: the page never names one.
    if ('folder' in args) throw new Error(`${command} a reçu un dossier de la page`);
    const name = command === 'body_config' ? 'corps.json' : (args.name as string);
    const found = files[name];
    if (found === undefined) throw `Fichier introuvable : ${name}`;
    if (found instanceof Error) throw found.message;
    return command === 'body_config' ? found : new TextEncoder().encode(found).buffer;
  };
const toUrl = (b: ArrayBuffer) => `blob:${new TextDecoder().decode(b)}`;

describe('readBodyFile', () => {
  it('reads the level, the images and the framing, bounded', () => {
    expect(
      readBodyFile(
        '{"niveau":"images","repos":"r.png","parole":"p.png","vignette":{"zoom":2,"x":40,"y":150}}',
      ),
    ).toEqual({ niveau: 'images', repos: 'r.png', parole: 'p.png', vignette: { zoom: 2, x: 40, y: 100 } });
    expect(readBodyFile('{"repos":"r.png"}')).toMatchObject({ niveau: 'images', parole: '', vignette: null });
  });

  it('says what is wrong instead of guessing', () => {
    expect(readBodyFile('pas du json')).toMatch(/JSON/);
    expect(readBodyFile('[]')).toMatch(/illisible/);
    expect(readBodyFile('{"niveau":"live2d","repos":"r.png"}')).toMatch(/niveau/);
    expect(readBodyFile('{"niveau":"images"}')).toMatch(/repos/);
  });
});

describe('loadBody', () => {
  it('two images: the body in images, the framing kept', async () => {
    const call = folderWith({
      'corps.json': '{"repos":"r.png","parole":"p.png","vignette":{"zoom":2,"x":50,"y":30}}',
      'r.png': 'R',
      'p.png': 'P',
    });
    expect(await loadBody(call, toUrl)).toEqual({
      view: { level: 'images', rest: 'blob:R', talking: 'blob:P', crop: { zoom: 2, x: 50, y: 30 } },
      said: 'Les images du dossier.',
    });
  });

  it('never sends a folder: body_config takes nothing, body_image only a name', async () => {
    const seen: [string, Record<string, unknown>][] = [];
    const inner = folderWith({
      'corps.json': '{"repos":"r.png","parole":"p.png"}',
      'r.png': 'R',
      'p.png': 'P',
    });
    const call: Call = (command, args) => {
      seen.push([command, args]);
      return inner(command, args);
    };
    await loadBody(call, toUrl);
    expect(seen).toEqual([
      ['body_config', {}],
      ['body_image', { name: 'r.png' }],
      ['body_image', { name: 'p.png' }],
    ]);
  });

  it('no folder kept by the window: Rust says so, the breath, and why', async () => {
    const r = await loadBody(async () => {
      throw 'Aucun dossier du corps choisi.';
    }, toUrl);
    expect(r.view).toEqual(BREATH);
    expect(r.said).toBe('Aucun dossier du corps choisi. Le souffle en attendant.');
  });

  it('no corps.json, a refused rest image: the breath, and why', async () => {
    const none = await loadBody(folderWith({}), toUrl);
    expect(none.view).toEqual(BREATH);
    expect(none.said).toMatch(/corps\.json/);
    const refused = await loadBody(
      folderWith({
        'corps.json': '{"repos":"r.png"}',
        'r.png': new Error('Fichier hors du dossier : r.png'),
      }),
      toUrl,
    );
    expect(refused.view).toEqual(BREATH);
    expect(refused.said).toMatch(/hors du dossier/);
  });

  it('a missing talking image keeps the rest image, the mouth still', async () => {
    const r = await loadBody(
      folderWith({ 'corps.json': '{"repos":"r.png","parole":"p.png"}', 'r.png': 'R' }),
      toUrl,
    );
    expect(r.view).toMatchObject({ level: 'images', rest: 'blob:R', talking: '' });
    expect(r.said).toMatch(/bouche reste fermée/);
  });

  it('the file says the breath: the breath', async () => {
    const r = await loadBody(folderWith({ 'corps.json': '{"niveau":"souffle"}' }), toUrl);
    expect(r.view).toEqual(BREATH);
  });
});
