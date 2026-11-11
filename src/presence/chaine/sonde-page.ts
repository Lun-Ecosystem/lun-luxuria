import { ancreLocale, installerSonde, type Banc, type PlanDePartie } from './sonde.ts';

/**
 * The probe's script, built in one file (`vite build --config vite.sonde.config.ts`). The player poses it with
 * `addInitScript`, followed by `__sonde(<plan>)`, before any script of the page.
 */
declare global {
  interface Window {
    __sonde(plan: PlanDePartie): void;
    __banc?: Banc;
  }
}

window.__sonde = (plan) => {
  window.__banc = installerSonde(window, plan, ancreLocale);
};
