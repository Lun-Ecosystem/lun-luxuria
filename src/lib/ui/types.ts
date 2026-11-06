// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
/** Shared types of the base ui components (values of plate 10). */
import type { IconComponent } from './Icon.ts';

/**
 * Tones of a badge: color, soft background, border. `ia` marks what the AI proposed or did alone;
 * `accent` takes the color of the world.
 */
export type Tone = 'ok' | 'attention' | 'danger' | 'info' | 'ia' | 'accent' | 'neutre';

/** Five button levels, plus the filled danger of a confirmation. */
export type ButtonVariant = 'principal' | 'doux' | 'secondaire' | 'fantome' | 'danger' | 'danger-plein';

/** Control heights: 28, 34 and 42 px. */
export type Size = 'petit' | 'normal' | 'grand';

/** One choice of a select or a segmented control. */
export interface Option {
  value: string;
  label: string;
  /** Second line of the entry, in the open list only. */
  hint?: string;
  disabled?: boolean;
  /** Before the label in a segmented control; alone with `iconOnly`, the label naming it. */
  icon?: IconComponent;
}

/**
 * Forced state, honoured by the components for the catalogue page only (`data-etat="survol"`),
 * so that a hover or a keyboard focus can be shown without the pointer.
 */
export type DemoState = 'survol' | 'focus';

/** State of the sorting service, shown at the bottom of the rail. */
export type ServiceState = 'actif' | 'pause' | 'cle-refusee';

/** One command of the palette (Ctrl K). */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Kind of command, shown at the end of the line (« Action », « Aller à »). */
  group: string;
  icon?: IconComponent | undefined;
  run: () => void;
}

/** One destination of a navigation (rail, bottom bar). */
export interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  count?: number | string | undefined;
  /** `ia`: counts what waits for a validation. */
  countTone?: 'neutre' | 'ia' | undefined;
}
