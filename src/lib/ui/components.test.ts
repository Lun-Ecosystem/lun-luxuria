// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import ServiceCard from './ServiceCard.svelte';
import StandaloneCard from './StandaloneCard.svelte';
import StatCard from './StatCard.svelte';
import Steps from './Steps.svelte';

describe('ServiceCard', () => {
  it.each([
    ['actif', 'Traitement actif'],
    ['pause', 'Traitement en pause'],
    ['cle-refusee', 'Traitement en pause'],
  ] as const)('%s reads « %s »', (state, title) => {
    render(ServiceCard, { props: { state, detail: 'Synchronisé il y a 1 min' } });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(title);
    expect(status).toHaveTextContent('Synchronisé il y a 1 min');
  });
});

describe('StandaloneCard', () => {
  const html = (h: string) => createRawSnippet(() => ({ render: () => h }));

  it('is one region named by its title, with the brand, the steps, a top and a footer', () => {
    render(StandaloneCard, {
      props: {
        title: 'Relier ce navigateur',
        brand: "Lun'Avaritia",
        lead: 'Saisir le code.',
        steps: html('<span>étapes</span>'),
        top: html('<span data-testid="haut">marques</span>'),
        children: html('<p>corps</p>'),
        footer: html('<span>note</span>'),
      },
    });
    const card = screen.getByRole('region', { name: 'Relier ce navigateur' });
    expect(screen.getByRole('main')).toContainElement(card);
    expect(screen.getByText("Lun'Avaritia")).toBeInTheDocument();
    expect(screen.getByText('étapes')).toBeInTheDocument();
    // The top goes above the title, inside the card.
    const top = screen.getByTestId('haut');
    expect(card).toContainElement(top);
    expect(top.compareDocumentPosition(screen.getByRole('heading', { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('Saisir le code.')).toBeInTheDocument();
    expect(screen.getByText('note')).toBeInTheDocument();
  });
});

describe('Steps', () => {
  it('marks the current step', () => {
    render(Steps, { props: { steps: ['Navigateur relié', 'Autoriser'], current: 1 } });
    expect(screen.getByText('Autoriser').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});

describe('StatCard', () => {
  it('names the count first and links to the screen', () => {
    render(StatCard, {
      props: {
        label: 'Contradictions',
        value: 2,
        sub: 'une décision attendue',
        href: '/valider?filtre=contradictions',
        action: 'Trancher',
        tone: 'danger',
      },
    });
    expect(screen.getByText('Contradictions')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Contradictions : Trancher' });
    expect(link).toHaveAttribute('href', '/valider?filtre=contradictions');
    expect(link).toHaveClass('secondaire');
  });
});
