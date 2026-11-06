<!-- Copie générée depuis lun-docs/design/kit : ne pas modifier ici -->
<script lang="ts">
  import Field from '../Field.svelte';
  import TextInput from '../TextInput.svelte';

  let { hint, error }: { hint?: string | undefined; error?: string | undefined } = $props();
  let value = $state('48 21');
</script>

<Field label="Code d’appairage" {hint} {error}>
  <TextInput bind:value />
</Field>
