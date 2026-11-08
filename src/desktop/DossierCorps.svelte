<script lang="ts">
  import { Button, SettingsCard, SettingsRow, TextInput } from '../lib/ui/index.ts';
  import type { Session } from '../session.svelte.ts';
  import type { Settings } from '../settings.ts';
  import { reloadBody } from './corps.svelte.ts';

  /* In the window, the body comes from its folder: its corps.json decides the level and the images. */

  let { session, set }: { session: Session; set: (change: (draft: Settings) => void) => void } = $props();
</script>

<SettingsCard title="Son corps" description="Sur ce poste seulement.">
  <SettingsRow
    label="Dossier du corps"
    hint={session.bodySaid || 'Son corps.json décide du niveau et des images.'}
  >
    <TextInput
      value={session.settings.body.folder}
      size="petit"
      aria-label="Dossier du corps"
      onchange={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value.trim();
        set((d) => (d.body.folder = v));
      }}
    />
    <Button variant="secondaire" size="petit" onclick={() => void reloadBody(session)}>Relire</Button>
  </SettingsRow>
</SettingsCard>
