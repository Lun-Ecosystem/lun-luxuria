import { describe, expect, it, vi } from 'vitest';
import { forgetFolder, formerWaiting, pickFolder, readFolders } from './dossiers.ts';
import { Session } from '../session.svelte.ts';

/** The window's answers by command name; what the page asked, kept. */
function window_(answers: Record<string, unknown>) {
  const asked: [string, Record<string, unknown>][] = [];
  const call = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    asked.push([command, args]);
    const answer = answers[command];
    if (answer instanceof Error) throw answer.message;
    return answer ?? null;
  });
  return { call, asked };
}

describe('the folders the window keeps', () => {
  it('readFolders: what the window keeps, nothing otherwise', async () => {
    const session = new Session();
    await readFolders(session, window_({ folder_paths: { corps: 'C:\\corps' } }).call);
    expect(session.folders).toEqual({ corps: 'C:\\corps' });
    await readFolders(session, window_({ folder_paths: null }).call);
    expect(session.folders).toEqual({});
    await readFolders(session, window_({ folder_paths: new Error('illisible') }).call);
    expect(session.folders).toEqual({});
  });

  it('pickFolder: the name only goes to the window; the path it gives is kept', async () => {
    const session = new Session();
    const { call, asked } = window_({ folder_pick: 'C:\\corps' });
    await pickFolder(session, 'corps', call);
    expect(asked).toEqual([['folder_pick', { name: 'corps' }]]);
    expect(session.folders.corps).toBe('C:\\corps');
  });

  it('pickFolder: cancelled (null) or refused, the kept folder stays and nothing throws', async () => {
    const session = new Session();
    session.folders.corps = 'C:\\corps';
    await pickFolder(session, 'corps', window_({ folder_pick: null }).call);
    expect(session.folders.corps).toBe('C:\\corps');
    await pickFolder(
      session,
      'corps',
      window_({ folder_pick: new Error('Une boîte est déjà ouverte.') }).call,
    );
    expect(session.folders.corps).toBe('C:\\corps');
  });

  it('formerWaiting: the old folder by its name, only while the window keeps none', () => {
    const session = new Session();
    expect(formerWaiting(session, 'corps')).toBe('');
    session.saveSettings({
      ...session.settings,
      body: { ...session.settings.body, formerFolder: 'C:\\corps' },
    });
    expect(formerWaiting(session, 'corps')).toBe('C:\\corps');
    expect(formerWaiting(session, 'voix')).toBe('');
    session.folders.corps = 'C:\\autre';
    expect(formerWaiting(session, 'corps')).toBe('');
    localStorage.clear();
  });

  it('forgetFolder: by its name, and the page forgets it only when the window did', async () => {
    const session = new Session();
    session.folders.corps = 'C:\\corps';
    await forgetFolder(session, 'corps', window_({ folder_forget: new Error('refusé') }).call);
    expect(session.folders.corps).toBe('C:\\corps');
    const { call, asked } = window_({});
    await forgetFolder(session, 'corps', call);
    expect(asked).toEqual([['folder_forget', { name: 'corps' }]]);
    expect(session.folders.corps).toBeUndefined();
  });
});
