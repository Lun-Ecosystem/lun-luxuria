import { invoke } from '@tauri-apps/api/core';
import type { Session } from '../session.svelte.ts';
import type { Call } from './corps.svelte.ts';

/** The folders the window keeps, by name: the person chooses them in the system's dialog, the page never names one. */
export type FolderName = 'corps' | 'voix';

/** The folders as the window keeps them. */
export async function readFolders(session: Session, call: Call = invoke): Promise<void> {
  const paths = await Promise.resolve(call('folder_paths', {})).catch(() => null);
  session.folders = paths && typeof paths === 'object' ? (paths as Session['folders']) : {};
}

/** The system's dialog, opened by the window. True: a folder chosen; false: cancelled; a string: the refusal. */
export async function pickFolder(
  session: Session,
  name: FolderName,
  call: Call = invoke,
): Promise<boolean | string> {
  try {
    const path = await call('folder_pick', { name });
    if (typeof path !== 'string') return false;
    session.folders[name] = path;
    return true;
  } catch (err) {
    return String(err);
  }
}

/** True once the window forgot it; a string: its refusal, and the page still shows the folder. */
export async function forgetFolder(
  session: Session,
  name: FolderName,
  call: Call = invoke,
): Promise<true | string> {
  try {
    await call('folder_forget', { name });
    delete session.folders[name];
    return true;
  } catch (err) {
    return String(err);
  }
}
