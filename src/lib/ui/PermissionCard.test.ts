// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PermissionCard from './PermissionCard.svelte';

const base = {
  what: 'Ouvrir le dossier Téléchargements',
  target: 'C:\\Users\\…\\Downloads',
  reason: 'Pour retrouver le fichier.',
  meta: ['Poste', 'maintenant'],
  scope: 'pour ce dossier',
};
const bouton = (name: string) => screen.getByRole('button', { name });

describe('PermissionCard', () => {
  it('waiting, says the action, its target and why, and offers the three answers', async () => {
    const onanswer = vi.fn();
    render(PermissionCard, { props: { ...base, level: 3, onanswer } });
    const sheet = screen.getByRole('article');
    expect(sheet).toHaveTextContent('Permission');
    expect(screen.getByRole('heading', { level: 3, name: base.what })).toBeInTheDocument();
    expect(sheet).toHaveTextContent(base.target);
    expect(sheet).toHaveTextContent('Pour retrouver le fichier.');
    await userEvent.click(bouton('Une fois'));
    await userEvent.click(bouton('Toujours pour ce dossier'));
    await userEvent.click(bouton('Refuser'));
    expect(onanswer.mock.calls).toEqual([['once'], ['always'], ['refuse']]);
  });

  it('waiting without a function to answer, shows no answer', () => {
    render(PermissionCard, { props: base });
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an « always » without a scope is said alone', () => {
    render(PermissionCard, { props: { what: base.what, onanswer: vi.fn() } });
    expect(bouton('Toujours')).toBeInTheDocument();
  });

  it('busy: the sheet says so, the answer ignores clicks, the others wait', async () => {
    const onanswer = vi.fn();
    render(PermissionCard, { props: { ...base, busy: true, onanswer } });
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(bouton('Une fois'));
    expect(onanswer).not.toHaveBeenCalled();
    expect(bouton('Toujours pour ce dossier')).toBeDisabled();
    expect(bouton('Refuser')).toBeDisabled();
  });

  it.each([
    ['once', `Autorisé une fois : ${base.what}`],
    ['always', `Toujours autorisé pour ce dossier : ${base.what}`],
    ['refused', `Refusé : ${base.what}`],
    ['unanswered', `Sans réponse, rien n’a eu lieu : ${base.what}`],
  ] as const)('%s folds into one line, without the answers', (status, texte) => {
    render(PermissionCard, { props: { ...base, status, onanswer: vi.fn() } });
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText(texte)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Une fois' })).toBeNull();
  });

  it('only an « always » can be taken back', async () => {
    const onrevoke = vi.fn();
    const { unmount } = render(PermissionCard, { props: { ...base, status: 'always', onrevoke } });
    await userEvent.click(bouton('Ne plus autoriser'));
    expect(onrevoke).toHaveBeenCalledOnce();
    unmount();
    render(PermissionCard, { props: { ...base, status: 'once', onrevoke } });
    expect(screen.queryByRole('button', { name: 'Ne plus autoriser' })).toBeNull();
  });
});
