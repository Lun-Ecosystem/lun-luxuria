// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DecisionGroup from './DecisionGroup.svelte';
import type { GroupCard } from './types.ts';

// Plan lun-docs#222: the group « Valider ensemble ».
const rendre = async (props: Partial<ComponentProps<typeof DecisionGroup>>) =>
  render(DecisionGroup, { props: { cards: cartes(), ...props } });

const champs = () => [
  {
    name: 'boite',
    label: 'Boîte',
    value: ['factures'],
    choices: [
      { value: 'factures', label: 'Factures' },
      { value: 'banque', label: 'Banque' },
    ],
  },
];
const carte = (id: string, extra: Partial<GroupCard> = {}): GroupCard => ({
  id,
  title: `Facture ${id}`,
  kind: 'Rangement',
  bulk: true,
  fields: champs(),
  ...extra,
});
const cartes = () => [carte('A'), carte('B'), carte('C')];

const bouton = (name: string) => screen.getByRole('button', { name });
const case_ = (id: string) => screen.getByRole('checkbox', { name: `Facture ${id}` });
const ligne = (id: string) =>
  screen.getByRole('heading', { name: `Facture ${id}` }).closest('article') as HTMLElement;
const corriger = async (id: string) => {
  await userEvent.click(within(ligne(id)).getByRole('button', { name: 'Corriger' }));
  await userEvent.click(within(ligne(id)).getByRole('radio', { name: 'Banque' }));
  await userEvent.click(within(ligne(id)).getByRole('button', { name: 'Valider ainsi' }));
};

afterEach(() => vi.restoreAllMocks());

describe('DecisionGroup, what it shows', () => {
  it('a section named "Valider ensemble", its invitation, a checked box per card, the main gesture', async () => {
    await rendre({});
    expect(screen.getByRole('region', { name: 'Valider ensemble' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Valider ensemble' })).toBeInTheDocument();
    expect(screen.getByText('Décocher une carte pour la laisser à trancher.')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const c of screen.getAllByRole('checkbox')) expect(c).toBeChecked();
    expect(screen.getByRole('heading', { level: 4, name: 'Facture A' })).toBeInTheDocument();
    expect(bouton('Valider les 3 cartes')).toBeInTheDocument();
  });

  it('level moves the header and the cards with it', async () => {
    await rendre({ level: 2 });
    expect(screen.getByRole('heading', { level: 2, name: 'Valider ensemble' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Facture A' })).toBeInTheDocument();
  });

  it('one and many name the cards in the texts', async () => {
    await rendre({ one: 'proposition', many: 'propositions' });
    expect(screen.getByText('Décocher une proposition pour la laisser à trancher.')).toBeInTheDocument();
    expect(bouton('Valider les 3 propositions')).toBeInTheDocument();
  });

  it('each row is a narrow card with its values and "Corriger", without "Valider" or "Refuser"', async () => {
    await rendre({});
    const a = within(ligne('A'));
    expect(ligne('A')).toHaveClass('narrow');
    expect(ligne('A')).toHaveTextContent('Factures');
    expect(a.getByRole('button', { name: 'Corriger' })).toBeInTheDocument();
    expect(a.queryByRole('button', { name: 'Valider' })).toBeNull();
    expect(a.queryByRole('button', { name: 'Refuser' })).toBeNull();
  });

  it('a card with sends, with options or without bulk is neither shown nor counted, and warns once per id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusees = [
      carte('S', { sends: 'un envoi' }),
      carte('O', { options: ['Mardi'] }),
      carte('N', { bulk: undefined }),
    ];
    const view = await rendre({ cards: [carte('A'), carte('B'), ...refusees] });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Facture S' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Facture O' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Facture N' })).toBeNull();
    expect(bouton('Valider les 2 cartes')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(3);
    for (const id of ['S', 'O', 'N'])
      expect(warn.mock.calls.some((c) => String(c[0]).includes(id))).toBe(true);
    await view.rerender({ cards: [carte('A'), carte('B'), ...refusees, carte('C')], busy: false });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('mounted without a card it takes, it draws nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = await rendre({ cards: [carte('S', { sends: 'un envoi' })] });
    // Svelte leaves its comment anchor: nothing drawn means no element.
    expect(container.children).toHaveLength(0);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('does not take the focus when it mounts', async () => {
    await rendre({});
    expect(document.body).toHaveFocus();
  });
});

describe('DecisionGroup, the gesture', () => {
  it('unchecking two cards leaves "Valider la carte"; unchecking all three, "Aucune carte cochée", disabled', async () => {
    await rendre({ onaccept: vi.fn() });
    await userEvent.click(case_('A'));
    await userEvent.click(case_('B'));
    expect(bouton('Valider la carte')).toBeEnabled();
    await userEvent.click(case_('C'));
    expect(bouton('Aucune carte cochée')).toBeDisabled();
  });

  it('calls onaccept once, with the ids of the checked cards only', async () => {
    const onaccept = vi.fn();
    await rendre({ onaccept });
    await userEvent.click(case_('B'));
    await userEvent.click(bouton('Valider les 2 cartes'));
    expect(onaccept).toHaveBeenCalledOnce();
    expect(onaccept).toHaveBeenCalledWith(['A', 'C']);
  });

  it('a corrected card leaves at once, goes alone through oncorrect, and does not come back', async () => {
    const oncorrect = vi.fn();
    const onaccept = vi.fn();
    const donnees = cartes();
    const view = await rendre({ cards: donnees, oncorrect, onaccept });
    await corriger('A');
    expect(oncorrect).toHaveBeenCalledOnce();
    expect(oncorrect).toHaveBeenCalledWith('A', { boite: ['banque'] });
    expect(screen.queryByRole('heading', { name: 'Facture A' })).toBeNull();
    expect(bouton('Valider les 2 cartes')).toBeInTheDocument();
    await view.rerender({ cards: donnees, oncorrect, onaccept });
    expect(screen.queryByRole('heading', { name: 'Facture A' })).toBeNull();
    await userEvent.click(bouton('Valider les 2 cartes'));
    expect(onaccept).toHaveBeenCalledWith(['B', 'C']);
  });

  it('a card leaving gives the focus to the checkbox of the next row, else of the previous one', async () => {
    await rendre({ oncorrect: vi.fn() });
    await corriger('B');
    expect(case_('C')).toHaveFocus();
    await corriger('C');
    expect(case_('A')).toHaveFocus();
  });

  it('the last card leaving: the group stays drawn, the button is disabled, the focus goes to "Fermer"', async () => {
    await rendre({ cards: [carte('A')], oncorrect: vi.fn(), onclose: vi.fn() });
    await corriger('A');
    expect(screen.getByRole('region', { name: 'Valider ensemble' })).toBeInTheDocument();
    expect(bouton('Aucune carte cochée')).toBeDisabled();
    expect(bouton('Fermer')).toHaveFocus();
  });

  it('busy: the button spins and keeps the focus; corrections and boxes wait', async () => {
    const onaccept = vi.fn();
    await rendre({ busy: true, onaccept });
    const principal = bouton('Valider les 3 cartes');
    principal.focus();
    expect(principal).toHaveAttribute('aria-busy', 'true');
    expect(principal).toHaveFocus();
    await userEvent.click(principal);
    expect(onaccept).not.toHaveBeenCalled();
    expect(within(ligne('A')).getByRole('button', { name: 'Corriger' })).toBeDisabled();
    expect(case_('A')).toBeDisabled();
  });

  it('off: everything is disabled, and the line that says why is read once', async () => {
    await rendre({ off: 'Indisponible tant que le poste ne répond pas.', oncorrect: vi.fn() });
    expect(screen.getAllByText('Indisponible tant que le poste ne répond pas.')).toHaveLength(1);
    expect(bouton('Valider les 3 cartes')).toBeDisabled();
    expect(case_('A')).toBeDisabled();
    expect(within(ligne('A')).getByRole('button', { name: 'Corriger' })).toBeDisabled();
  });
});

describe('DecisionGroup, closing', () => {
  it('"Fermer" calls onclose', async () => {
    const onclose = vi.fn();
    await rendre({ onclose });
    await userEvent.click(bouton('Fermer'));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('Escape outside a correction calls onclose', async () => {
    const onclose = vi.fn();
    await rendre({ onclose });
    await fireEvent.keyDown(case_('A'), { key: 'Escape' });
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('Escape during a correction folds the card and does not call onclose', async () => {
    const onclose = vi.fn();
    await rendre({ onclose, oncorrect: vi.fn() });
    await userEvent.click(within(ligne('A')).getByRole('button', { name: 'Corriger' }));
    await fireEvent.keyDown(within(ligne('A')).getByRole('radio', { name: 'Factures' }), { key: 'Escape' });
    expect(onclose).not.toHaveBeenCalled();
    expect(within(ligne('A')).queryByRole('radiogroup')).toBeNull();
  });

  it('speaks neither in "je" nor in "tu"', async () => {
    await rendre({});
    const texte = screen.getByRole('region', { name: 'Valider ensemble' }).textContent ?? '';
    expect(texte).toContain('Décocher');
    expect(texte).not.toMatch(/\b(je|tu|j’|t’)\b/i);
  });
});
