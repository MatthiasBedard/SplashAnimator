<script lang="ts">
  let { importFile }: { importFile: (file: File, family: string) => Promise<void> } = $props();
  let file = $state<File>();
  let family = $state('');
  let authorized = $state(false);
  let pending = $state(false);
  let error = $state('');

  async function apply() {
    if (!file || !authorized || !family.trim() || pending) return;
    pending = true;
    error = '';
    try { await importFile(file, family.trim()); }
    catch (cause) { error = String(cause); }
    finally { pending = false; }
  }
</script>

<h2>Embed project font</h2>
<p>Import one TrueType face up to 1 MiB. Its bytes will travel with this project and with HTML that uses it.</p>
<label>TrueType font <input type="file" accept=".ttf,font/ttf" disabled={pending}
  onchange={(event) => {
    file = event.currentTarget.files?.[0];
    authorized = false;
    family = file?.name.replace(/\.ttf$/i, '').replace(/[^A-Za-z0-9 _-]/g, ' ').trim().slice(0, 70) ?? '';
  }} /></label>
<label>Project family name <input bind:value={family} maxlength="70" disabled={pending} /></label>
<label><input type="checkbox" bind:checked={authorized} disabled={pending} />
  I have permission to embed and distribute this font with my project and exports.
</label>
<button onclick={apply} disabled={!file || !family.trim() || !authorized || pending}>Embed font</button>
{#if error}<p role="alert">{error}</p>{/if}
