<script lang="ts">
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import Mic from '@lucide/svelte/icons/mic';
  import MicOff from '@lucide/svelte/icons/mic-off';
  import Minimize2 from '@lucide/svelte/icons/minimize-2';
  import Moon from '@lucide/svelte/icons/moon';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import { SvelteSet } from 'svelte/reactivity';
  import { Mouth, STATE_LABELS } from './body/body.ts';
  import { inWindow } from './desktop/net.ts';
  import Fil from './Fil.svelte';
  import { IconButton } from './lib/ui/index.ts';
  import type { Session } from './session.svelte.ts';

  let { session, openSettings }: { session: Session; openSettings: (theme?: 'voix') => void } = $props();
  const mouth = new Mouth();
  const open = $derived(mouth.next(session.level));
  const small = $derived(session.layout === 'small');
  // In the window, the body's folder decides; in a browser tab, the addresses of the settings.
  const body = $derived(session.bodyView ?? session.settings.body);
  const crop = $derived(small ? (session.bodyView?.crop ?? null) : null);
  // By address: a repaired address is a new one and shows at once; a broken one never loads again.
  const broken = new SvelteSet<string>();
  const src = $derived(open && body.talking && !broken.has(body.talking) ? body.talking : body.rest);
  const images = $derived(body.level === 'images' && body.rest !== '' && !broken.has(body.rest));
  // The breath follows the sound really played: stopped, it is at rest at once.
  const scale = $derived(1 + Math.min(session.level * 2.2, 0.35));
</script>

<!-- In the window, the thumbnail moves by its background. -->
<div
  class={['scene', { small }]}
  data-etat={session.state}
  data-tauri-drag-region={small && inWindow ? '' : undefined}
>
  <!-- Layers: body, subtitles, controls, thread. They stay apart for the stream to come. -->
  <div class="corps" aria-hidden="true">
    {#if images}
      <!-- The address that failed, not the one shown now: the mouth may have moved meanwhile. -->
      <!-- The frame keeps the thumbnail's zoom on the face. -->
      <span class="cadre">
        <img
          {src}
          alt=""
          style:transform={crop ? `scale(${crop.zoom})` : undefined}
          style:transform-origin={crop ? `${crop.x}% ${crop.y}%` : undefined}
          onerror={(e) => broken.add(e.currentTarget.getAttribute('src') ?? src)}
        />
      </span>
    {:else}
      <div class="souffle" style:transform="scale({scale})"></div>
    {/if}
  </div>

  <div class="sous-titres" aria-live="polite">
    {#if session.subtitle}<p>{session.subtitle}</p>{/if}
  </div>

  <div class="etat">
    {#if session.state === 'busy' || session.busyOverride}
      <button class="etiquette reprise" onclick={() => session.takeBackMic()}>
        {session.busyOverride ? 'Micro repris, rendre à la détection' : 'Micro occupé, le reprendre'}
      </button>
    {:else}
      <span class="etiquette">{STATE_LABELS[session.state]}</span>
    {/if}
    {#if session.trace}<span class="trace">Filtré : {session.trace}</span>{/if}
    {#if session.failure}<span class="echec" role="alert">{session.failure}</span>{/if}
    {#if session.voiceStatus === 'down'}
      <span class="echec" role="status">
        Sa voix ne répond pas : il ne t’entend pas et ne parle pas.
        <button class="reprise" onclick={() => openSettings('voix')}>Régler la voix</button>
      </span>
    {:else if session.voiceStatus === 'starting'}
      <span class="etiquette" role="status">Sa voix démarre : les modèles se chargent.</span>
    {/if}
  </div>

  <div class="controles">
    {#if session.speaking || session.reading}
      <IconButton icon={VolumeX} label="Faire taire" onclick={() => session.silence()} />
    {/if}
    <IconButton
      icon={Moon}
      label={session.silenced ? 'Sortir de la sourdine' : 'Mettre en sourdine'}
      aria-pressed={session.silenced}
      onclick={() => session.toggleMute()}
    />
    <IconButton
      icon={session.micOn ? Mic : MicOff}
      label={session.micOn ? 'Couper le micro' : 'Ouvrir le micro'}
      aria-pressed={session.micOn}
      onclick={() => session.toggleMic()}
    />
    <IconButton
      icon={MessageSquare}
      label={session.threadOpen ? 'Fermer le fil' : 'Ouvrir le fil'}
      aria-pressed={session.threadOpen}
      onclick={() => (session.threadOpen = !session.threadOpen)}
    />
    <IconButton
      icon={small ? Maximize2 : Minimize2}
      label={small ? 'Revenir à la scène' : 'Passer en petit mode'}
      onclick={() => session.setLayout(small ? 'scene' : 'small')}
    />
    <IconButton icon={Settings2} label="Réglages" onclick={() => openSettings()} />
  </div>

  {#if session.threadOpen}
    <Fil {session} />
  {/if}
</div>

<style>
  .scene {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 42%, var(--accent-doux), transparent 58%), var(--scene);
  }
  .corps {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-bottom: 12vh;
    pointer-events: none;
  }
  .corps img {
    max-height: 72vh;
    max-width: 80vw;
    object-fit: contain;
  }
  .souffle {
    width: min(26vh, 40vw);
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle, var(--accent-texte) 0%, var(--accent) 38%, transparent 70%);
    filter: blur(6px);
    opacity: 0.55;
    transition: transform 70ms linear;
  }
  [data-etat='listening'] .souffle {
    opacity: 0.8;
  }
  [data-etat='thinking'] .souffle {
    animation: pense 1.8s ease-in-out infinite;
  }
  [data-etat='speaking'] .souffle {
    opacity: 0.95;
  }
  [data-etat='muted'] .souffle,
  [data-etat='unreachable'] .souffle {
    opacity: 0.2;
  }
  @keyframes pense {
    50% {
      opacity: 0.8;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .souffle {
      transition: none;
      animation: none !important;
    }
  }
  .sous-titres {
    position: absolute;
    left: 50%;
    bottom: 11vh;
    width: min(760px, calc(100% - 32px));
    transform: translateX(-50%);
    text-align: center;
    min-height: 2.6em;
  }
  .sous-titres p {
    margin: 0;
    font-family: 'Cormorant Garamond', serif;
    font-weight: 500;
    font-size: clamp(22px, 2.6vw, 34px);
    line-height: 1.3;
  }
  .etat {
    position: absolute;
    top: 18px;
    left: 20px;
    right: 240px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    font-size: 13px;
  }
  .etiquette {
    color: var(--texte-2);
    letter-spacing: 0.02em;
  }
  .reprise {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent-texte);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .trace {
    color: var(--texte-3);
  }
  .echec {
    color: var(--attention);
  }
  .controles {
    position: absolute;
    top: 12px;
    right: 14px;
    display: flex;
    gap: 2px;
    z-index: 2;
  }

  /* The small mode: a thumbnail with its last sentence. Always-on-top comes with the desktop window. */
  .small .corps {
    align-items: flex-start;
    padding: 58px 0 0;
  }
  .small .souffle {
    width: 72px;
  }
  .small .corps img {
    max-height: 96px;
  }
  .cadre {
    display: flex;
    overflow: hidden;
  }
  .small .sous-titres {
    top: 142px;
    bottom: auto;
  }
  .small .sous-titres p {
    font-size: 19px;
  }
  .small .etat {
    right: 14px;
    top: 50px;
    font-size: 12px;
  }
  @media (max-width: 480px) {
    .etat {
      right: 14px;
      top: 58px;
    }
  }
</style>
