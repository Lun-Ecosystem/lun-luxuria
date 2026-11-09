// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodeInput from './CodeInput.svelte';
import ConfirmDialog from './ConfirmDialog.svelte';
import { Archive } from './Icon.ts';
import IconButton from './IconButton.svelte';
import Toaster from './Toaster.svelte';
import { dismissAll, toast } from './toasts.svelte.ts';

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    dismissAll();
    vi.useRealTimers();
  });

  const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });

  const ctrlZ = '{Control>}z{/Control}';

  it('Ctrl Z runs the undo of the toast, which then goes away', async () => {
    render(Toaster);
    const undo = vi.fn(() => Promise.resolve());
    toast('Validée : Paul Mercier.', { undo });
    await tick();
    expect(screen.getByText('Ctrl Z')).toBeInTheDocument();
    await user().keyboard(ctrlZ);
    await vi.advanceTimersByTimeAsync(0);
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('Validée : Paul Mercier.')).toBeNull();
  });

  it('Z alone does nothing', async () => {
    render(Toaster);
    const undo = vi.fn(() => Promise.resolve());
    toast('Validée : A.', { undo });
    await tick();
    await user().keyboard('z');
    expect(undo).not.toHaveBeenCalled();
  });

  it('Ctrl Z does nothing from a field', async () => {
    render(Toaster);
    const input = document.createElement('input');
    document.body.append(input);
    const undo = vi.fn(() => Promise.resolve());
    toast('Validée : A.', { undo });
    await tick();
    input.focus();
    await user().keyboard(ctrlZ);
    expect(undo).not.toHaveBeenCalled();
    input.remove();
  });

  it('an undoable toast shows the seconds left, and leaves after 5 s', async () => {
    render(Toaster);
    toast('Refusée : Adresse de Marion.', {
      undo: vi.fn(() => Promise.resolve()),
    });
    await tick();
    expect(screen.getByText('5 s')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByText('4 s')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3999);
    expect(screen.getByText('Refusée : Adresse de Marion.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Refusée : Adresse de Marion.')).toBeNull();
  });

  it('an information toast stays 3 s, without Annuler', async () => {
    render(Toaster);
    toast('Réglage enregistré');
    await tick();
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
    await vi.advanceTimersByTimeAsync(2999);
    expect(screen.getByText('Réglage enregistré')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Réglage enregistré')).toBeNull();
  });

  it('one toast at a time: a new gesture replaces the toast and the first can no longer be undone', async () => {
    render(Toaster);
    const first = vi.fn(() => Promise.resolve());
    const second = vi.fn(() => Promise.resolve());
    toast('Validée : A.', { undo: first });
    toast('Validée : B.', { undo: second });
    await tick();
    expect(screen.queryByText('Validée : A.')).toBeNull();
    await user().keyboard(ctrlZ);
    await vi.advanceTimersByTimeAsync(0);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('an information toast waits for the undoable one to end', async () => {
    render(Toaster);
    toast('Validée : A.', { undo: vi.fn(() => Promise.resolve()) });
    toast('Déjà tranchée ailleurs.');
    await tick();
    expect(screen.getByText('Validée : A.')).toBeInTheDocument();
    expect(screen.queryByText('Déjà tranchée ailleurs.')).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText('Déjà tranchée ailleurs.')).toBeInTheDocument();
  });

  it('an undo that fails replaces the toast by its message, in the danger tone', async () => {
    render(Toaster);
    const undo = vi.fn(() => Promise.reject(new Error('Trop tard pour annuler.')));
    toast('Rangé dans Administratif', { undo });
    await tick();
    await user().click(screen.getByRole('button', { name: 'Annuler' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('Rangé dans Administratif')).toBeNull();
    const message = screen.getByText('Trop tard pour annuler.');
    expect(message.closest('[data-ton]')).toHaveAttribute('data-ton', 'danger');
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('a danger toast stays 5 s', async () => {
    render(Toaster);
    toast('Échec.', { tone: 'danger' });
    await tick();
    await vi.advanceTimersByTimeAsync(4999);
    expect(screen.getByText('Échec.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Échec.')).toBeNull();
  });

  it('of several information toasts waiting, only the latest shows after the undoable one, for 3 s', async () => {
    render(Toaster);
    toast('Validée : A.', { undo: vi.fn(() => Promise.resolve()) });
    toast('Info 1.');
    toast('Info 2.');
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText('Info 1.')).toBeNull();
    expect(screen.getByText('Info 2.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2999);
    expect(screen.getByText('Info 2.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Info 2.')).toBeNull();
  });

  it('a waiting information toast survives a new undoable toast', async () => {
    render(Toaster);
    toast('Validée : A.', { undo: vi.fn(() => Promise.resolve()) });
    toast('Déjà tranchée ailleurs.');
    toast('Validée : B.', { undo: vi.fn(() => Promise.resolve()) });
    await tick();
    expect(screen.getByText('Validée : B.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText('Déjà tranchée ailleurs.')).toBeInTheDocument();
  });

  it('the seconds and the key hint are hidden from the live region', async () => {
    render(Toaster);
    toast('Validée : A.', { undo: vi.fn(() => Promise.resolve()) });
    await tick();
    expect(screen.getByText('5 s')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Ctrl Z').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('an error waiting behind an undoable toast is not replaced by an information', async () => {
    render(Toaster);
    toast('Rangé dans Administratif', { undo: vi.fn(() => Promise.resolve()) });
    toast('L’envoi a échoué.', { tone: 'danger' });
    toast('Brouillon enregistré.');
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText('Brouillon enregistré.')).toBeNull();
    const message = screen.getByText('L’envoi a échoué.');
    expect(message.closest('[data-ton]')).toHaveAttribute('data-ton', 'danger');
  });

  it('an error arriving after a waiting information takes its place', async () => {
    render(Toaster);
    toast('Rangé dans Administratif', { undo: vi.fn(() => Promise.resolve()) });
    toast('Brouillon enregistré.');
    toast('L’envoi a échoué.', { tone: 'danger' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText('Brouillon enregistré.')).toBeNull();
    expect(screen.getByText('L’envoi a échoué.')).toBeInTheDocument();
  });

  it('between two waiting errors, the latest wins', async () => {
    render(Toaster);
    toast('Rangé dans Administratif', { undo: vi.fn(() => Promise.resolve()) });
    toast('L’envoi a échoué.', { tone: 'danger' });
    toast('La copie a échoué.', { tone: 'danger' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText('L’envoi a échoué.')).toBeNull();
    expect(screen.getByText('La copie a échoué.')).toBeInTheDocument();
  });

  it('an error waiting while Annuler runs survives the information that takes the screen', async () => {
    render(Toaster);
    toast('Rangé dans Administratif', { undo: vi.fn(() => new Promise<void>(() => {})) });
    toast('L’envoi a échoué.', { tone: 'danger' });
    await tick();
    await user().click(screen.getByRole('button', { name: 'Annuler' }));
    toast('Brouillon enregistré.');
    await tick();
    expect(screen.getByText('Brouillon enregistré.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.getByText('L’envoi a échoué.')).toBeInTheDocument();
  });

  it('contained changes the placement', async () => {
    const { container } = render(Toaster, { contained: true });
    expect(container.querySelector('.toaster')).toHaveClass('contained');
  });
});

describe('CodeInput', () => {
  it.each(['482 917', '482·917'])('a paste of « %s » completes with 482917', async (pasted) => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.click(input);
    await user.paste(pasted);
    expect(oncomplete).toHaveBeenCalledExactlyOnceWith('482917');
    expect(input).toHaveValue('482917');
  });

  it('outside a Field, is described by the id it is given', () => {
    render(CodeInput, { props: { error: true, 'aria-describedby': 'pourquoi' } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    expect(input).toHaveAttribute('aria-describedby', 'pourquoi');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('a refused code pasted again completes again (retry)', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { value: '482917', error: true, oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.click(input);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('482 917');
    expect(oncomplete).toHaveBeenCalledExactlyOnceWith('482917');
    expect(input).toHaveValue('482917');
  });

  it('a key typed into a full code sends nothing more', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.type(input, '482917');
    expect(oncomplete).toHaveBeenCalledOnce();
    await user.type(input, '3');
    await user.type(input, '45');
    expect(oncomplete).toHaveBeenCalledOnce();
    expect(input).toHaveValue('482917');
  });

  it('a full code given by the parent, then a key typed: nothing sent', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { value: '482917', oncomplete } });
    await user.type(screen.getByRole('textbox', { name: 'Code à 6 chiffres' }), '3');
    expect(oncomplete).not.toHaveBeenCalled();
  });

  it('keeps only the digits typed, and completes at the sixth', async () => {
    const user = userEvent.setup();
    const oncomplete = vi.fn();
    render(CodeInput, { props: { oncomplete } });
    const input = screen.getByRole('textbox', { name: 'Code à 6 chiffres' });
    await user.type(input, '48a2 9');
    expect(input).toHaveValue('4829');
    expect(oncomplete).not.toHaveBeenCalled();
    await user.type(input, '17');
    expect(oncomplete).toHaveBeenCalledExactlyOnceWith('482917');
  });
});

/** Lets Bits finish opening a layer (focus scope, escape layer) before a key is pressed. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('ConfirmDialog', () => {
  const props = {
    title: 'Retirer Safari sur iPhone ?',
    message: 'Cet appareil perdra l’accès à Lun’Avaritia.',
    confirmLabel: 'Retirer l’appareil',
  };

  it('calls onconfirm only on a click of its button', async () => {
    const user = userEvent.setup();
    const onconfirm = vi.fn(() => Promise.resolve());
    const { rerender } = render(ConfirmDialog, { props: { ...props, open: true, onconfirm } });
    expect(screen.getByRole('alertdialog', { name: props.title })).toBeInTheDocument();
    expect(onconfirm).not.toHaveBeenCalled();

    await settle();
    await user.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await rerender({ open: true });
    await settle();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onconfirm).not.toHaveBeenCalled();

    await rerender({ open: true });
    await settle();
    await user.click(screen.getByRole('button', { name: 'Retirer l’appareil' }));
    expect(onconfirm).toHaveBeenCalledOnce();
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('opens with the focus on the harmless choice', async () => {
    render(ConfirmDialog, { props: { ...props, open: true, onconfirm: vi.fn(), cancelLabel: 'Fermer' } });
    await settle();
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
  });

  it('can confirm with the full danger button', () => {
    render(ConfirmDialog, {
      props: { ...props, open: true, onconfirm: vi.fn(), confirmVariant: 'danger-plein' },
    });
    expect(screen.getByRole('button', { name: props.confirmLabel })).toHaveClass('danger-plein');
  });

  it('stays open and says why when the action fails', async () => {
    const user = userEvent.setup();
    const onconfirm = vi.fn(() => Promise.reject(new Error('Le serveur ne répond pas.')));
    render(ConfirmDialog, { props: { ...props, open: true, onconfirm } });
    await user.click(screen.getByRole('button', { name: 'Retirer l’appareil' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Le serveur ne répond pas.')).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('a handler given by the caller keeps the tooltip working', async () => {
    const user = userEvent.setup();
    const onfocus = vi.fn();
    render(IconButton, { props: { icon: Archive, label: 'Archiver', shortcut: 'E', onfocus } });
    await user.tab();
    const button = screen.getByRole('button', { name: 'Archiver' });
    expect(button).toHaveFocus();
    expect(onfocus).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('data-state');
    expect(button).not.toHaveAttribute('data-state', 'closed');
  });
});
