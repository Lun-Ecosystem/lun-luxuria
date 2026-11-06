<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import type { ServiceState } from './types.ts';

  /** State of the sorting service, always visible at the bottom of the rail. */

  type Props = {
    state: ServiceState;
    /** What goes with the state (« Synchronisé il y a 1 min », « Clé refusée »). */
    detail: string;
    /** The product's own wording of the state; the sorting service's by default. */
    title?: string | undefined;
    class?: string | undefined;
  };

  let { state, detail, title, class: className }: Props = $props();

  const TITLES: Record<ServiceState, string> = {
    actif: 'Traitement actif',
    pause: 'Traitement en pause',
    'cle-refusee': 'Traitement en pause',
  };
</script>

<div class={['service', state, className]} role="status">
  <span class="point" aria-hidden="true"></span>
  <div>
    <b>{title ?? TITLES[state]}</b>
    <span class="detail">{detail}</span>
  </div>
</div>

<style>
  .service {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: 8px;
    padding: 9px 10px;
    background: var(--surface-1);
    border: 1px solid var(--bordure);
    border-radius: var(--r-2);
    color: var(--texte-2);
    font: 300 12px/1.4 var(--sans);
  }
  .point {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 0 3px var(--ok-doux);
  }
  .pause .point {
    background: var(--attention);
    box-shadow: 0 0 0 3px var(--attention-doux);
  }
  .cle-refusee {
    border-color: var(--danger-bord);
  }
  .cle-refusee .point {
    background: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-doux);
  }
  b {
    display: block;
    font-weight: 400;
    font-size: 12.5px;
    color: var(--texte);
  }
  .detail {
    display: block;
  }
</style>
