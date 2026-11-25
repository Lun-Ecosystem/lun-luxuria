// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import DecisionCard from './DecisionCard.svelte';
import { X } from './Icon.ts';

const html = (h: string) => createRawSnippet(() => ({ render: () => h }));
const base = { title: 'Ranger la facture dans Factures', kind: 'Rangement', meta: ['Poste', '09:12'] };
const bouton = (name: string) => screen.getByRole('button', { name });

describe('DecisionCard, waiting', () => {
  it('takes the color of the world and an icon before its title, without changing the title’s name', () => {
    const { container } = render(DecisionCard, { props: { ...base, tone: 'accent', icon: X } });
    expect(screen.getByRole('article')).toHaveClass('accent');
    expect(container.querySelector('.title svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('heading', { name: base.title })).toBeInTheDocument();
  });

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
  it.each(['done', 'refused', 'failed', 'expired'] as const)('%s says the line it is given', (status) => {
    render(DecisionCard, { props: { ...base, status, doneText: 'Rangé', lineText: 'Sans réponse.' } });
    expect(screen.getByText('Sans réponse.')).toBeInTheDocument();
  });

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

// Plan lun-docs#222: what the card learns (`fields`, `importance`, the correction).
type Props = Partial<ComponentProps<typeof DecisionCard>>;
const rendre = (props: Props) => render(DecisionCard, { props: { ...base, ...props } });

const champs = () => [
  {
    name: 'boite',
    label: 'Boîte',
    value: ['factures'],
    choices: [
      { value: 'factures', label: 'Factures' },
      { value: 'banque', label: 'Banque' },
      { value: 'achats', label: 'Achats' },
    ],
  },
  {
    name: 'etiquettes',
    label: 'Étiquettes',
    value: ['a-payer'],
    multiple: true as const,
    choices: [
      { value: 'a-payer', label: 'À payer' },
      { value: 'pro', label: 'Pro' },
      { value: 'perso', label: 'Perso' },
    ],
  },
];
const corrigeable = (extra: Props = {}): Props => ({
  fields: champs(),
  oncorrect: vi.fn(),
  onaccept: vi.fn(),
  ...extra,
});
const ouvrir = async () => userEvent.click(bouton('Corriger'));

describe('DecisionCard, fields', () => {
  it('shows each field label and the label of each proposed value', () => {
    rendre(corrigeable());
    const carte = screen.getByRole('article');
    expect(carte).toHaveTextContent('Boîte');
    expect(carte).toHaveTextContent('Factures');
    expect(carte).toHaveTextContent('Étiquettes');
    expect(carte).toHaveTextContent('À payer');
    expect(carte.querySelector('dl')).not.toBeNull();
  });

  it('joins the labels of a multiple field with commas, and says "aucun choix" when it is empty', () => {
    const f = champs();
    f[1]!.value = ['a-payer', 'pro'];
    const { unmount } = rendre({ fields: f });
    expect(screen.getByRole('article')).toHaveTextContent('À payer, Pro');
    unmount();
    f[1]!.value = [];
    rendre({ fields: f });
    expect(screen.getByRole('article')).toHaveTextContent('aucun choix');
  });

  it('a value outside the choices is shown as it is', () => {
    const f = champs();
    f[0]!.value = ['inconnue'];
    rendre({ fields: f });
    expect(screen.getByRole('article')).toHaveTextContent('inconnue');
  });

  // Green on `main` too: a guard.
  it('shows no "Corriger" without oncorrect, without fields, or with empty fields', () => {
    rendre({ fields: champs(), onaccept: vi.fn() }).unmount();
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull();
    rendre({ oncorrect: vi.fn(), onaccept: vi.fn() }).unmount();
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull();
    rendre({ fields: [], oncorrect: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull();
  });

  it('fields and options together: only the options show, no values, no "Corriger"', () => {
    rendre(corrigeable({ options: ['Mardi', 'Jeudi'] }));
    expect(bouton('Mardi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corriger' })).toBeNull();
    expect(screen.getByRole('article')).not.toHaveTextContent('Boîte');
    // The base title already says « Factures »: the values are looked for in their list.
    expect(screen.getByRole('article').querySelector('dl')).toBeNull();
  });

  it('"Corriger" follows "Valider", before "Modifier", and waits when locked', () => {
    const { unmount } = rendre(corrigeable({ onedit: vi.fn() }));
    const noms = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(noms.indexOf('Valider')).toBeLessThan(noms.indexOf('Corriger'));
    expect(noms.indexOf('Corriger')).toBeLessThan(noms.indexOf('Modifier'));
    unmount();
    rendre(corrigeable({ busy: true }));
    expect(bouton('Corriger')).toBeDisabled();
  });
});

describe('DecisionCard, correcting', () => {
  it('"Corriger" unfolds: aria-expanded true, a radiogroup per single field, a group of checkboxes per multiple', async () => {
    rendre(corrigeable());
    const corriger = bouton('Corriger');
    expect(corriger).toHaveAttribute('aria-expanded', 'false');
    expect(corriger).toHaveAttribute('aria-controls');
    await ouvrir();
    expect(bouton('Corriger')).toHaveAttribute('aria-expanded', 'true');
    const unique = screen.getByRole('radiogroup', { name: 'Boîte' });
    expect(within(unique).getAllByRole('radio')).toHaveLength(3);
    const multiple = screen.getByRole('group', { name: 'Étiquettes' });
    expect(within(multiple).getAllByRole('checkbox')).toHaveLength(3);
  });

  it('the choices start from value; the gestures are "Valider ainsi", "Corriger" and "Annuler"', async () => {
    rendre(corrigeable({ onrefuse: vi.fn(), onedit: vi.fn(), onlater: vi.fn(), shortcuts: ['V', 'R'] }));
    expect(screen.getByRole('article').querySelector('.keys')).not.toBeNull();
    await ouvrir();
    expect(screen.getByRole('radio', { name: 'Factures' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Banque' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'À payer' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pro' })).not.toBeChecked();
    expect(bouton('Valider ainsi')).toBeInTheDocument();
    expect(bouton('Annuler')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
    for (const name of ['Modifier', 'Refuser', 'Plus tard'])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('article').querySelector('.keys')).toBeNull();
    const noms = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(noms.filter((n) => ['Valider ainsi', 'Corriger', 'Annuler'].includes(n ?? ''))).toEqual([
      'Valider ainsi',
      'Corriger',
      'Annuler',
    ]);
  });

  it('values keep only the choices: a proposed value outside them does not go back', async () => {
    const oncorrect = vi.fn();
    const f = champs();
    f[1]!.value = ['x'];
    rendre(corrigeable({ fields: f, oncorrect }));
    await ouvrir();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pro' }));
    await userEvent.click(bouton('Valider ainsi'));
    expect(oncorrect).toHaveBeenCalledWith({ etiquettes: ['pro'] });
  });

  it('no choice chip carries aria-pressed', async () => {
    rendre(corrigeable());
    await ouvrir();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
    for (const r of screen.getAllByRole('radio')) expect(r).not.toHaveAttribute('aria-pressed');
  });

  it('single: clicking another chip checks it and unchecks the first; an arrow changes the choice', async () => {
    rendre(corrigeable());
    await ouvrir();
    await userEvent.click(screen.getByRole('radio', { name: 'Banque' }));
    expect(screen.getByRole('radio', { name: 'Banque' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Factures' })).not.toBeChecked();
    screen.getByRole('radio', { name: 'Banque' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Achats' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Banque' })).not.toBeChecked();
  });

  it('"Valider ainsi" calls oncorrect once with the changed fields only, and folds', async () => {
    const oncorrect = vi.fn();
    rendre(corrigeable({ oncorrect }));
    await ouvrir();
    await userEvent.click(screen.getByRole('radio', { name: 'Banque' }));
    await userEvent.click(bouton('Valider ainsi'));
    expect(oncorrect).toHaveBeenCalledOnce();
    expect(oncorrect).toHaveBeenCalledWith({ boite: ['banque'] });
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(bouton('Corriger')).toHaveAttribute('aria-expanded', 'false');
  });

  it('multiple: unchecking everything then "Valider ainsi" gives an empty list', async () => {
    const oncorrect = vi.fn();
    rendre(corrigeable({ oncorrect }));
    await ouvrir();
    await userEvent.click(screen.getByRole('checkbox', { name: 'À payer' }));
    await userEvent.click(bouton('Valider ainsi'));
    expect(oncorrect).toHaveBeenCalledWith({ etiquettes: [] });
  });

  it('"Valider ainsi" waits while nothing differs, or while a single field has no choice', async () => {
    const { unmount } = rendre(corrigeable());
    await ouvrir();
    expect(bouton('Valider ainsi')).toBeDisabled();
    unmount();
    const f = champs();
    f[0]!.value = [];
    rendre(corrigeable({ fields: f }));
    await ouvrir();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pro' }));
    expect(bouton('Valider ainsi')).toBeDisabled();
  });

  it('"Annuler" folds without calling oncorrect and gives the focus back to "Corriger"', async () => {
    const oncorrect = vi.fn();
    rendre(corrigeable({ oncorrect }));
    await ouvrir();
    await userEvent.click(screen.getByRole('radio', { name: 'Banque' }));
    await userEvent.click(bouton('Annuler'));
    expect(oncorrect).not.toHaveBeenCalled();
    expect(bouton('Corriger')).toHaveFocus();
    await ouvrir();
    expect(screen.getByRole('radio', { name: 'Factures' })).toBeChecked();
  });

  it('Escape while correcting folds, calls nothing, is taken and does not rise; focus goes to "Corriger"', async () => {
    const oncorrect = vi.fn();
    const parent = vi.fn();
    document.body.addEventListener('keydown', parent);
    try {
      rendre(corrigeable({ oncorrect }));
      await ouvrir();
      const libre = await fireEvent.keyDown(screen.getByRole('radio', { name: 'Factures' }), {
        key: 'Escape',
      });
      expect(libre).toBe(false);
      expect(parent).not.toHaveBeenCalled();
      expect(oncorrect).not.toHaveBeenCalled();
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(bouton('Corriger')).toHaveFocus();
    } finally {
      document.body.removeEventListener('keydown', parent);
    }
  });

  it('Escape on a folded card is left alone', async () => {
    const parent = vi.fn();
    document.body.addEventListener('keydown', parent);
    try {
      rendre(corrigeable());
      const libre = await fireEvent.keyDown(bouton('Corriger'), { key: 'Escape' });
      expect(libre).toBe(true);
      expect(parent).toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('keydown', parent);
    }
  });

  it('the app’s onkeydown is still called, folded or unfolded', async () => {
    const onkeydown = vi.fn();
    rendre(corrigeable({ onkeydown }));
    await fireEvent.keyDown(bouton('Corriger'), { key: 'x' });
    expect(onkeydown).toHaveBeenCalledTimes(1);
    await ouvrir();
    await fireEvent.keyDown(screen.getByRole('radio', { name: 'Factures' }), { key: 'Escape' });
    expect(onkeydown).toHaveBeenCalledTimes(2);
  });

  it('opening puts the focus on the checked choice of the first field', async () => {
    rendre(corrigeable());
    await ouvrir();
    expect(screen.getByRole('radio', { name: 'Factures' })).toHaveFocus();
  });

  it('mounted with correcting: unfolded, and the focus does not move', () => {
    rendre(corrigeable({ correcting: true }));
    expect(screen.getByRole('radiogroup', { name: 'Boîte' })).toBeInTheDocument();
    expect(bouton('Corriger')).toHaveAttribute('aria-expanded', 'true');
    expect(document.body).toHaveFocus();
  });

  it('after "Valider ainsi" the card sets neither tabindex nor focus', async () => {
    rendre(corrigeable());
    await ouvrir();
    await userEvent.click(screen.getByRole('radio', { name: 'Banque' }));
    await userEvent.click(bouton('Valider ainsi'));
    expect(screen.getByRole('article')).not.toHaveAttribute('tabindex');
    expect(screen.getByRole('article')).not.toContainElement(document.activeElement as HTMLElement);
  });

  it('a failure: rendered again with error, the card waits folded with the alert and "Corriger" back', async () => {
    const view = rendre(corrigeable());
    await ouvrir();
    await userEvent.click(screen.getByRole('radio', { name: 'Banque' }));
    await userEvent.click(bouton('Valider ainsi'));
    await view.rerender({ ...base, ...corrigeable(), error: 'le poste ne répond pas.' });
    expect(screen.getByRole('alert')).toHaveTextContent('N’a pas abouti : le poste ne répond pas.');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(bouton('Corriger')).toHaveAttribute('aria-expanded', 'false');
    await ouvrir();
    expect(screen.getByRole('radio', { name: 'Factures' })).toBeChecked();
  });

  it('speaks neither in "je" nor in "tu"', async () => {
    rendre(corrigeable());
    await ouvrir();
    expect(screen.getByRole('article').textContent).toContain('Valider ainsi');
    expect(screen.getByRole('article').textContent).not.toMatch(/\b(je|tu|j’|t’)\b/i);
  });
});

describe('DecisionCard, importance', () => {
  it('urgent shows "Urgent", even without kind or meta', () => {
    const { unmount } = rendre({ importance: 'urgent' });
    expect(screen.getByRole('article')).toHaveTextContent('Urgent');
    unmount();
    rendre({ importance: 'urgent', kind: undefined, meta: [] });
    expect(screen.getByRole('article')).toHaveTextContent('Urgent');
  });

  it('urgent comes before the kind', () => {
    rendre({ importance: 'urgent' });
    const sourcil = screen.getByRole('article').querySelector('.eyebrow')!;
    expect(sourcil.textContent!.indexOf('Urgent')).toBeGreaterThanOrEqual(0);
    expect(sourcil.textContent!.indexOf('Urgent')).toBeLessThan(sourcil.textContent!.indexOf('Rangement'));
  });

  describe.each(['normal', 'low', 'info', 'log', undefined] as const)('importance %s', (importance) => {
    // Green on `main` too: the prop is ignored. A guard, not a red case.
    it('shows nothing', () => {
      rendre({ importance });
      expect(screen.getByRole('article')).not.toHaveTextContent('Urgent');
    });
  });
});
