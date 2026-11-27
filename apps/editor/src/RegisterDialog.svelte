<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { wrapDialogTab } from './dialog-focus';
  import { MAX_LICENSE_LENGTH } from './license-token';
  import { license } from './license.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let field = $state<HTMLTextAreaElement>();
  let replaceButton = $state<HTMLButtonElement>();
  let fileInput = $state<HTMLInputElement>();
  let code = $state(''), message = $state(''), busy = $state(false), failed = $state(false);
  let readingFile = $state(false);
  let replacing = $state(false);
  const showForm = $derived(!license.claims || replacing);
  const editionNames = { trial: 'Trial', single: 'Single-user', commercial: 'Commercial' };
  const date = (value: number) => new Date(value * 1000).toLocaleDateString();

  onMount(() => {
    dialog.showModal();
    if (showForm) field?.focus();
  });

  async function toggleReplacement() {
    replacing = !replacing;
    code = '';
    message = '';
    if (replacing) {
      await tick();
      field?.focus();
    } else {
      replaceButton?.focus();
    }
  }

  async function loadLicenseFile() {
    const file = fileInput?.files?.[0];
    if (!file || !fileInput || busy || readingFile) return;
    fileInput.value = '';
    readingFile = true;
    message = '';
    try {
      // A signed code is ASCII. Allow room for a UTF-8 BOM and a trailing CRLF.
      if (file.size > MAX_LICENSE_LENGTH + 5) throw Error('The license file is too large.');
      const loaded = (await file.text()).trim();
      if (!loaded) throw Error('The license file is empty.');
      if (loaded.length > MAX_LICENSE_LENGTH) throw Error('The license code is too long.');
      code = loaded;
      failed = false;
      message = 'License code loaded. Select Register license to verify it.';
    } catch (error) {
      failed = true;
      message = error instanceof Error ? error.message : 'Could not read the license file.';
    } finally {
      readingFile = false;
    }
  }

  async function register(event: SubmitEvent) {
    event.preventDefault();
    if (busy || readingFile || !code.trim()) return;
    busy = true;
    message = '';
    try {
      await license.register(code);
      code = '';
      replacing = false;
      failed = false;
      message = 'License registered.';
    } catch (error) {
      failed = true;
      message = error instanceof Error ? error.message : 'Could not register this license.';
    } finally {
      busy = false;
      await tick();
      if (dialog?.open && dialog.isConnected) {
        if (failed) {
          const active = document.activeElement;
          if (!dialog.contains(active) || active === dialog || active?.matches('button[type="submit"]')) field?.focus();
        } else replaceButton?.focus();
      }
    }
  }
</script>

<dialog class="dialog" aria-labelledby="register-title" bind:this={dialog} {onclose} onkeydown={wrapDialogTab}>
  <button class="dialog-close" aria-label="Close Register" onclick={() => dialog.close()}>×</button>
  <header>
    <h2 id="register-title">Register Splash Animator</h2>
    <span class="license-status" class:valid={!!license.claims}>
      {license.claims ? `${editionNames[license.claims.edition]} license` : 'Unlicensed'}
    </span>
  </header>
  {#if license.claims}
    {@const claims = license.claims}
    <section aria-label="Licensing" class="license-details">
      <div class="cards">
        <section class="card">
          <h3>License holder</h3>
          <dl>
            {#if claims.name}<div><dt>Licensed to</dt><dd>{claims.name}</dd></div>{/if}
            {#if claims.company_name}<div><dt>Company</dt><dd>{claims.company_name}</dd></div>{/if}
            <div><dt>Email</dt><dd>{claims.email}</dd></div>
          </dl>
        </section>
        <section class="card">
          <h3>Permissions</h3>
          <dl>
            <div><dt>Expires</dt><dd>{claims.exp === undefined ? 'Perpetual' : date(claims.exp)}</dd></div>
            <div><dt>Save and export</dt><dd>{claims.can_save ? 'Enabled' : 'Disabled'}</dd></div>
            <div><dt>Commercial use</dt><dd>{claims.commercial_use ? 'Permitted' : 'Evaluation only'}</dd></div>
            {#if claims.revenue_limit_usd !== undefined}
              <div><dt>Annual revenue limit</dt><dd>${claims.revenue_limit_usd.toLocaleString()} USD</dd></div>
            {/if}
          </dl>
        </section>
      </div>
      <details class="technical">
        <summary>Technical details</summary>
        <dl>
          <div class="license-id"><dt>License ID</dt><dd>{claims.jti}</dd></div>
          <div><dt>Issuer</dt><dd>{claims.iss}</dd></div>
          <div><dt>Software</dt><dd>{claims.software_key}</dd></div>
          <div><dt>Issued</dt><dd>{date(claims.iat)}</dd></div>
          <div><dt>License version</dt><dd>{claims.license_version}</dd></div>
        </dl>
      </details>
    </section>
  {:else}
    <p>No valid license. Saving and exporting are disabled.</p>
  {/if}
  {#if message}<p class="feedback" class:failed role={failed ? 'alert' : 'status'}>{message}</p>{/if}
  <footer>
    {#if license.claims}
      <button class="replacement" type="button" bind:this={replaceButton} disabled={busy || readingFile} aria-expanded={replacing}
        onclick={toggleReplacement}>{replacing ? 'Cancel replacement' : 'Replace license'}</button>
    {/if}
    {#if showForm}
      <form onsubmit={register}>
        <label>
          Signed license code
          <textarea bind:this={field} bind:value={code} rows="3" maxlength={MAX_LICENSE_LENGTH}
            spellcheck="false" autocomplete="off" readonly={readingFile}></textarea>
        </label>
        <input type="file" bind:this={fileInput} accept=".splashlicense,.txt" onchange={loadLicenseFile} hidden />
        <div class="form-actions">
          <button class="activate" disabled={busy || readingFile || !code.trim()} type="submit">
            {busy ? 'Verifying…' : 'Register license'}
          </button>
          <button class="replacement" type="button" disabled={busy || readingFile} onclick={() => fileInput?.click()}>
            Load license file…
          </button>
        </div>
      </form>
    {/if}
    <a class="purchase" href="https://splashanimator.com" target="_blank" rel="noopener noreferrer">Purchase a license at splashanimator.com</a>
  </footer>
</dialog>

<style>
  .purchase {
    display: block;
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
    margin: 12px 0 0 auto;
    padding: 8px 14px;
    border-radius: 4px;
    background: #b42332;
    color: white;
    font-weight: 700;
    text-align: center;
    text-decoration: none;
  }
  .purchase:hover { background: #971b28; }
  .purchase:focus-visible { outline: 2px solid white; outline-offset: 2px; }
  dialog.dialog {
    position: fixed;
    box-sizing: border-box;
    width: min(670px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow: auto;
    padding: clamp(18px, 4vw, 28px);
    background: #292c36;
    color: inherit;
  }
  dialog::backdrop {
    background: #11151cbf;
    backdrop-filter: blur(4px);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding-inline-end: 26px;
    margin-bottom: 18px;
  }
  header h2 { margin: 0; }
  .license-status {
    border: 1px solid #745057;
    border-radius: 999px;
    padding: 4px 10px;
    background: #3d303a;
    color: #ffa4a8;
    font-weight: 600;
  }
  .license-status.valid { border-color: #3d615c; background: #293d3d; color: #a4e1cb; }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .card {
    min-width: 0;
    padding: 13px 15px;
    border: 1px solid #494d60;
    border-radius: 8px;
    background: #222530;
  }
  .card h3 { margin: 0 0 9px; font-size: 14px; }
  dl { display: grid; gap: 8px; margin: 0; }
  dt { color: #a6adbf; font-size: 11px; }
  dd { margin: 2px 0 0; overflow-wrap: anywhere; font-weight: 600; }
  .technical { margin-top: 12px; border-block: 1px solid #494d60; }
  .technical summary { padding: 10px 0; color: var(--accent-text); cursor: pointer; }
  .technical dl { grid-template-columns: repeat(2, minmax(0, 1fr)); padding-bottom: 12px; }
  .license-id { grid-column: 1 / -1; }
  footer { margin-top: 14px; }
  .replacement { border-color: var(--accent-divider); padding: 6px 10px; }
  .replacement + form { margin-top: 12px; }
  form { display: grid; gap: 8px; justify-items: start; }
  .form-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  label { width: 100%; font-weight: 600; }
  textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin: 6px 0;
    padding: 8px;
    resize: vertical;
    font-family: ui-monospace, Consolas, monospace;
  }
  .activate { padding: 7px 12px; background: var(--brand); color: var(--on-brand); font-weight: 650; }
  .activate:hover:not(:disabled) { background: var(--brand-hover); }
  p.feedback { margin: 8px 0; color: #a4e1cb; overflow-wrap: anywhere; }
  p.feedback.failed { color: #ffa4a8; }
  @media (max-width: 560px) {
    .cards { grid-template-columns: minmax(0, 1fr); }
  }
</style>
