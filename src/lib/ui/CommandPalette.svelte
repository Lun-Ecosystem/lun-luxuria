<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import { Command, Dialog } from 'bits-ui';
  import { ICON_STROKE, Search } from './Icon.ts';
  import Kbd from './Kbd.svelte';
  import { mondeOf } from './monde.ts';
  import { bindShortcuts } from './shortcuts.ts';
  import type { PaletteCommand } from './types.ts';

  /*
   * Command palette, opened and closed by Ctrl K anywhere (Bits Command in a Dialog). The search
   * field carries `data-palette`, so Ctrl K still works from inside it. Arrows move, Enter runs,
   * Escape closes.
   */

  type Props = {
    commands: PaletteCommand[];
    open?: boolean | undefined;
    placeholder?: string | undefined;
    /** Binds Ctrl K on the window (one palette per page). */
    shortcut?: boolean | undefined;
    /** What is typed in the search field (a command can depend on it: « Rechercher … »). */
    search?: string | undefined;
  };

  let {
    commands,
    open = $bindable(false),
    placeholder = 'Rechercher une commande',
    shortcut = true,
    search = $bindable(''),
  }: Props = $props();

  let probe = $state<HTMLElement | null>(null);
  const monde = $derived(mondeOf(probe) ?? 'acedia');
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!shortcut) return;
    return bindShortcuts({ 'Ctrl+k': () => (open = !open) });
  });

  $effect(() => {
    if (!open) search = '';
  });

  function run(command: PaletteCommand) {
    open = false;
    command.run();
  }
</script>

<span bind:this={probe} hidden></span>
<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay>
      {#snippet child({ props })}<div {...props} class="voile"></div>{/snippet}
    </Dialog.Overlay>
    <Dialog.Content
      aria-label="Palette de commandes"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        input?.focus();
      }}
    >
      {#snippet child({ props })}
        <div {...props} class="palette" data-monde={monde}>
          <Command.Root label="Palette de commandes" loop>
            <div class="rech">
              <Search size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <Command.Input
                bind:ref={input}
                bind:value={search}
                {placeholder}
                data-palette=""
                class="champ"
              />
              <Kbd>Ctrl K</Kbd>
            </div>
            <Command.List class="liste">
              <Command.Viewport>
                <Command.Empty class="vide">Aucune commande trouvée</Command.Empty>
                {#each commands as command (command.id)}
                  {@const Icon = command.icon}
                  <Command.Item
                    value={command.id}
                    keywords={[command.label, command.group]}
                    onSelect={() => run(command)}
                  >
                    {#snippet child({ props: itemProps })}
                      <div {...itemProps} class="item">
                        {#if Icon}<Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />{/if}
                        <span class="texte">{command.label}</span>
                        <small>{command.group}</small>
                      </div>
                    {/snippet}
                  </Command.Item>
                {/each}
              </Command.Viewport>
            </Command.List>
            <div class="pied" aria-hidden="true">
              <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> naviguer</span>
              <span><Kbd>↵</Kbd> ouvrir</span>
              <span><Kbd>Échap</Kbd> fermer</span>
            </div>
          </Command.Root>
        </div>
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .voile {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: color-mix(in srgb, var(--fond) 60%, transparent);
  }
  .palette {
    box-sizing: border-box;
    position: fixed;
    top: 14vh;
    left: 50%;
    z-index: 51;
    width: min(560px, calc(100vw - 32px));
    overflow: hidden;
    background: var(--surface-2);
    border: 1px solid var(--bordure-forte);
    border-radius: var(--r-3);
    box-shadow: var(--ombre-2);
    color: var(--texte);
    font: 300 13.5px/1.4 var(--sans);
    transform: translateX(-50%);
    outline: none;
  }
  .rech {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--bordure);
    color: var(--texte-3);
  }
  .rech :global(svg) {
    flex: none;
  }
  .rech :global(.champ) {
    flex: 1;
    min-width: 0;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 0;
    color: var(--texte);
    font: 300 14px var(--sans);
    outline: none;
  }
  .rech :global(.champ::placeholder) {
    color: var(--texte-3);
  }
  .palette :global(.liste) {
    max-height: min(360px, 50vh);
    overflow-y: auto;
    padding: 6px 0;
  }
  .palette :global(.vide) {
    padding: 14px;
    color: var(--texte-3);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    color: var(--texte);
    cursor: pointer;
  }
  .item :global(svg) {
    flex: none;
    color: var(--texte-2);
  }
  .item[data-selected] {
    background: var(--appui);
  }
  .texte {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--texte-3);
  }
  .pied {
    display: flex;
    gap: 14px;
    padding: 8px 14px;
    border-top: 1px solid var(--bordure);
    font-size: 12px;
    color: var(--texte-3);
  }
  @media (max-width: 767.98px) {
    .palette {
      top: 12px;
    }
    .pied {
      display: none;
    }
  }
</style>
