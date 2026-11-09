import type { Settings } from './settings.ts';

/** What entering still waits for, said as such; null when nothing is missing. */
export function missingToEnter(s: Settings, token: string | null): string | null {
  if (s.brain === 'linked') return token ? null : 'Il manque le code d’appairage.';
  if (!s.model.url.trim()) return 'Il manque l’adresse du modèle.';
  if (!s.model.name.trim()) return 'Il manque le nom du modèle.';
  return null;
}
