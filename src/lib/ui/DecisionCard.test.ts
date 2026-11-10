// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import DecisionCard from './DecisionCard.svelte';

const html = (h: string) => createRawSnippet(() => ({ render: () => h }));
const base = { title: 'Ranger la facture dans Factures', kind: 'Rangement', meta: ['Poste', '09:12'] };
const bouton = (name: string) => screen.getByRole('button', { name });

describe('DecisionCard, waiting', () => {
  it('is an article with its eyebrow, its title at the level asked, the lines of the contract and the reason', () => {
    render(DecisionCard, {
      props: { ...base, level: 3, lines: ['De : Opérateur', 'Boîte : Factures'], reason: 'Même expéditeur.' },
    });
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('Rangement');
    expect(card).toHaveTextContent('09:12');
    expect(screen.getByRole('heading', { level: 3, name: base.title })).toBeInTheDocument();
    expect(card).toHaveTextContent('Boîte : Factures');
    expect(card).toHaveTextContent('Pourquoi');
  });

  it('shows a gesture only when it has its function, and calls it', async () => {
    const onaccept = vi.fn();
    const onrefuse = vi.fn();
    render(DecisionCard, { props: { ...base, onaccept, onrefuse } });
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Plus tard' })).toBeNull();
    await userEvent.click(bouton('Valider'));
    await userEvent.click(bouton('Refuser'));
    expect(onaccept).toHaveBeenCalledWith();
    expect(onrefuse).toHaveBeenCalledOnce();
  });

  it('edit, later and the accept label are the app’s', async () => {
    const onedit = vi.fn();
    const onlater = vi.fn();
    render(DecisionCard, {
      props: { ...base, acceptLabel: 'Créer le brouillon', onaccept: vi.fn(), onedit, onlater },
    });
    expect(bouton('Créer le brouillon')).toBeInTheDocument();
    await userEvent.click(bouton('Modifier'));
    await userEvent.click(bouton('Plus tard'));
    expect(onedit).toHaveBeenCalledOnce();
    expect(onlater).toHaveBeenCalledOnce();
  });

  it('a question offers its answers in place of accept, and gives the one chosen', async () => {
    const onaccept = vi.fn();
    render(DecisionCard, { props: { ...base, tone: 'attention', options: ['Mardi', 'Jeudi'], onaccept } });
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
    await userEvent.click(bouton('Jeudi'));
    expect(onaccept).toHaveBeenCalledWith('Jeudi');
  });

  it('busy: the card says so, the accept ignores clicks, the others wait', async () => {
    const onaccept = vi.fn();
    render(DecisionCard, { props: { ...base, busy: true, onaccept, onrefuse: vi.fn(), onedit: vi.fn() } });
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(bouton('Valider'));
    expect(onaccept).not.toHaveBeenCalled();
    expect(bouton('Refuser')).toBeDisabled();
    expect(bouton('Modifier')).toBeDisabled();
  });

  it('read only: the gestures stay in sight, disabled, under the line that says why', () => {
    render(DecisionCard, {
      props: {
        ...base,
        off: 'Indisponible tant que le poste ne répond pas.',
        onaccept: vi.fn(),
        onrefuse: vi.fn(),
      },
    });
    expect(screen.getByText('Indisponible tant que le poste ne répond pas.')).toBeInTheDocument();
    expect(bouton('Valider')).toBeDisabled();
    expect(bouton('Refuser')).toBeDisabled();
  });

  it('a gesture that failed leaves the card waiting: the error is an alert, and retry is its own function', async () => {
    const onaccept = vi.fn();
    const onretry = vi.fn();
    render(DecisionCard, {
      props: { ...base, error: 'le poste ne répond pas.', note: 'Crée un brouillon.', onaccept, onretry },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('N’a pas abouti : le poste ne répond pas.');
    expect(screen.queryByText('Crée un brouillon.')).toBeNull();
    await userEvent.click(bouton('Réessayer'));
    expect(onretry).toHaveBeenCalledOnce();
    expect(onaccept).not.toHaveBeenCalled();
  });

  it('says what accepting sends out before the gesture', () => {
    render(DecisionCard, { props: { ...base, note: 'Crée un brouillon : rien n’est envoyé.' } });
    expect(screen.getByText('Crée un brouillon : rien n’est envoyé.')).toBeInTheDocument();
  });

  it('takes the app’s body in place of the lines, and more gestures after its own', () => {
    render(DecisionCard, {
      props: {
        ...base,
        lines: ['ligne du contrat'],
        children: html('<p>corps de l’app</p>'),
        actions: html('<a href="#la">Ouvrir dans le poste</a>'),
      },
    });
    expect(screen.getByText('corps de l’app')).toBeInTheDocument();
    expect(screen.queryByText('ligne du contrat')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ouvrir dans le poste' })).toBeInTheDocument();
  });

  it('shows the keys it is given, hidden from readers and absent when narrow; the root takes the app’s attributes', () => {
    const { container, unmount } = render(DecisionCard, {
      props: { ...base, shortcuts: ['V', 'R'], tabindex: -1, 'data-id': 'c1' },
    });
    expect(container.querySelector('.keys')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.keys')).toHaveTextContent('VR');
    expect(screen.getByRole('article')).toHaveAttribute('data-id', 'c1');
    expect(screen.getByRole('article')).toHaveAttribute('tabindex', '-1');
    unmount();
    const etroite = render(DecisionCard, { props: { ...base, shortcuts: ['V', 'R'], narrow: true } });
    expect(etroite.container.querySelector('.keys')).toBeNull();
  });
});

describe('DecisionCard, decided', () => {
  it.each([
    ['done', 'Rangé dans Factures'],
    ['refused', `Refusée : ${base.title}`],
    ['failed', `N’a pas abouti : ${base.title}. La boîte est introuvable.`],
    ['expired', `Expirée : ${base.title}`],
  ] as const)('%s folds into one line, without the gestures of a waiting card', (status, texte) => {
    render(DecisionCard, {
      props: {
        ...base,
        status,
        doneText: 'Rangé dans Factures',
        error: 'La boîte est introuvable.',
        onaccept: vi.fn(),
        onrefuse: vi.fn(),
      },
    });
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByText(texte)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a done or refused card can be taken back; a done one keeps the app’s actions', async () => {
    const onundo = vi.fn();
    render(DecisionCard, {
      props: { ...base, status: 'done', onundo, doneActions: html('<a href="#b">Ouvrir le brouillon</a>') },
    });
    expect(screen.getByRole('link', { name: 'Ouvrir le brouillon' })).toBeInTheDocument();
    await userEvent.click(bouton('Annuler'));
    expect(onundo).toHaveBeenCalledOnce();
  });

  it('a failed or expired card can only be removed', async () => {
    const ondismiss = vi.fn();
    render(DecisionCard, { props: { ...base, status: 'expired', ondismiss, onundo: vi.fn() } });
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    await userEvent.click(bouton('Retirer'));
    expect(ondismiss).toHaveBeenCalledOnce();
  });
});
