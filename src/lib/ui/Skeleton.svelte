<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  /*
   * Loading placeholder, never a « Chargement… » text. The zone that loads carries `aria-busy`; the
   * placeholders are hidden from screen readers.
   */

  type Props = {
    /** CSS width (`40%`, `120px`). */
    width?: string | undefined;
    /** Height, in px (12 for a line, 30 for an avatar). */
    height?: number | undefined;
    shape?: 'ligne' | 'rond' | undefined;
    class?: string | undefined;
  };

  let { width = '100%', height, shape = 'ligne', class: className }: Props = $props();

  const size = $derived(height ?? (shape === 'rond' ? 30 : 12));
</script>

<span
  class={['squelette', shape, className]}
  style:width={shape === 'rond' ? `${size}px` : width}
  style:height="{size}px"
  aria-hidden="true"
></span>

<style>
  .squelette {
    display: block;
    flex: none;
    border-radius: 6px;
    background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
    background-size: 200% 100%;
    animation: luit 1.4s ease-in-out infinite;
  }
  .rond {
    border-radius: 50%;
  }
  @keyframes luit {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .squelette {
      animation: none;
    }
  }
</style>
