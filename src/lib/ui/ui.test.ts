// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FieldFixture from './fixtures/FieldFixture.svelte';
import TextAreaFixture from './fixtures/TextAreaFixture.svelte';
import Badge from './Badge.svelte';
import Button from './Button.svelte';
import DropZone from './DropZone.svelte';
import { Archive, Feather, Moon } from './Icon.ts';
import IconButton from './IconButton.svelte';
import Segmented from './Segmented.svelte';
import SettingsRow from './SettingsRow.svelte';
import Slider from './Slider.svelte';
import Switch from './Switch.svelte';
import { createRawSnippet } from 'svelte';

const text = (t: string) => createRawSnippet(() => ({ render: () => `<span>${t}</span>` }));

describe('Field', () => {
  it('labels its control and shows the hint under it', () => {
    render(FieldFixture, { props: { hint: '6 chiffres, reçus sur l’appareil.' } });
    const input = screen.getByLabelText('Code d’appairage');
    expect(input).toHaveAccessibleDescription('6 chiffres, reçus sur l’appareil.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('with an error, no longer shows the hint and marks the control invalid', () => {
    render(FieldFixture, {
      props: { hint: '6 chiffres, reçus sur l’appareil.', error: '6 chiffres attendus.' },
    });
    const input = screen.getByLabelText('Code d’appairage');
    expect(screen.queryByText('6 chiffres, reçus sur l’appareil.')).toBeNull();
    expect(screen.getByText('6 chiffres attendus.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('6 chiffres attendus.');
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'jour', label: 'Jour' },
    { value: 'semaine', label: 'Semaine' },
    { value: 'mois', label: 'Mois' },
  ];

  it('emits the chosen value, and never an empty one', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Segmented, { props: { options, value: 'semaine', label: 'Période', onchange } });
    expect(screen.getByRole('group', { name: 'Période' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Mois' }));
    expect(onchange).toHaveBeenLastCalledWith('mois');
    await user.click(screen.getByRole('radio', { name: 'Mois' }));
    expect(onchange).toHaveBeenCalledOnce();
    expect(screen.getByRole('radio', { name: 'Mois' })).toHaveAttribute('aria-checked', 'true');
  });
  it('shows icons alone, each named by its label', async () => {
    const onchange = vi.fn();
    render(Segmented, {
      props: {
        options: [
          { value: 'feather', label: 'Plume', icon: Feather },
          { value: 'moon', label: 'Lune', icon: Moon },
        ],
        value: 'feather',
        label: 'Icône',
        iconOnly: true,
        onchange,
      },
    });
    const lune = screen.getByRole('radio', { name: 'Lune' });
    expect(lune).not.toHaveTextContent('Lune');
    expect(lune.querySelector('svg')).not.toBeNull();
    await userEvent.setup().click(lune);
    expect(onchange).toHaveBeenCalledWith('moon');
  });
});

describe('SettingsRow', () => {
  it('an error replaces the hint and is announced', () => {
    render(SettingsRow, { props: { label: 'Plafond', hint: 'Entre 1 et 100', error: 'Valeur refusée' } });
    expect(screen.queryByText('Entre 1 et 100')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Valeur refusée');
  });
});

describe('IconButton', () => {
  it('is named by its label', () => {
    render(IconButton, { props: { icon: Archive, label: 'Archiver', shortcut: 'E' } });
    const button = screen.getByRole('button', { name: 'Archiver' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'E');
  });
});

describe('Button', () => {
  it('while loading, keeps its text and ignores clicks', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, {
      props: { variant: 'principal', loading: true, onclick, children: text('Vérification…') },
    });
    const button = screen.getByRole('button', { name: 'Vérification…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onclick).not.toHaveBeenCalled();
  });

  it('a disabled button does not act', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, { props: { disabled: true, onclick, children: text('Enregistrer') } });
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onclick).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('acts at once and reports the new state', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Switch, { props: { label: 'Tri automatique', onchange } });
    const control = screen.getByRole('switch', { name: 'Tri automatique' });
    await user.click(control);
    expect(onchange).toHaveBeenCalledWith(true);
    expect(control).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Slider', () => {
  it('reads « 95 % » and clamps a typed value', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Slider, { props: { value: 95, label: 'Seuil de confiance', onchange } });
    expect(screen.getByRole('slider', { name: 'Seuil de confiance' })).toHaveAttribute(
      'aria-valuetext',
      '95 %',
    );
    const input = screen.getByRole('textbox', { name: 'Seuil de confiance' });
    await user.clear(input);
    await user.type(input, '140{Enter}');
    expect(onchange).toHaveBeenCalledWith(100);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('Badge', () => {
  it('carries its tone', () => {
    render(Badge, { props: { tone: 'ok', dot: true, children: text('Connecté') } });
    expect(screen.getByText('Connecté').parentElement).toHaveClass('ok');
  });

  it('takes the accent of the world', () => {
    render(Badge, { props: { tone: 'accent', children: text('doublon') } });
    expect(screen.getByText('doublon').parentElement).toHaveClass('accent');
  });
});

describe('TextArea', () => {
  it('is labelled by its Field and binds its value', async () => {
    const user = userEvent.setup();
    render(TextAreaFixture);
    const area = screen.getByLabelText('Synthèse');
    expect(area.tagName).toBe('TEXTAREA');
    await user.type(area, ' suite');
    expect(screen.getByText('Valeur : Texte suite')).toBeInTheDocument();
  });
});

describe('DropZone', () => {
  const props = { title: 'Déposer', label: 'Choisir', icon: Archive };

  it('hands over the chosen files', async () => {
    const onfiles = vi.fn();
    render(DropZone, { props: { ...props, onfiles } });
    const f = new File(['x'], 'a.md');
    await userEvent.setup().upload(screen.getByLabelText('Choisir'), f);
    expect(onfiles).toHaveBeenCalledWith([f]);
  });

  it('hands over dropped files, but not while busy', async () => {
    const onfiles = vi.fn();
    const { container, rerender } = render(DropZone, { props: { ...props, onfiles } });
    const f = new File(['x'], 'a.md');
    await fireEvent.drop(container.querySelector('.zone')!, { dataTransfer: { files: [f] } });
    expect(onfiles).toHaveBeenCalledWith([f]);
    await rerender({ busy: true });
    await fireEvent.drop(container.querySelector('.zone')!, { dataTransfer: { files: [f] } });
    expect(onfiles).toHaveBeenCalledOnce();
  });

  it('keeps the drop highlight when the pointer moves onto a child', async () => {
    const { container } = render(DropZone, { props: { ...props, onfiles: vi.fn() } });
    const zone = container.querySelector('.zone')!;
    // jsdom has no DragEvent: the target is set by hand.
    const leave = (relatedTarget: Node) =>
      Object.assign(new Event('dragleave', { bubbles: true }), { relatedTarget });
    await fireEvent.dragOver(zone);
    expect(zone).toHaveClass('over');
    await fireEvent(zone, leave(screen.getByText('Déposer')));
    expect(zone).toHaveClass('over');
    await fireEvent(zone, leave(document.body));
    expect(zone).not.toHaveClass('over');
  });

  it('picks a folder with directory', () => {
    render(DropZone, { props: { ...props, directory: true, onfiles: vi.fn() } });
    expect(screen.getByLabelText('Choisir')).toHaveAttribute('webkitdirectory');
  });
});
