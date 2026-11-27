<script lang="ts">
  import { onMount } from 'svelte';
  import { version } from '../src-tauri/tauri.conf.json';
  import { wrapDialogTab } from './dialog-focus';
  import { license } from './license.svelte';

  let { onclose, onregister }: { onclose: () => void; onregister: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog class="dialog" aria-labelledby="about-title" bind:this={dialog} {onclose} onkeydown={wrapDialogTab}>
  <button class="dialog-close" aria-label="Close About" onclick={() => dialog.close()}>×</button>
  <h2 id="about-title">About Splash Animator</h2>
  <p>Splash Animator is a 2D vector animation editor for drawing artwork and animating it on a timeline.</p>
  <dl>
    <dt>Version</dt>
    <dd>{version}</dd>
    <dt>Owned by</dt>
    <dd>Premstream</dd>
    <dt>Website</dt>
    <dd><a href="https://splashanimator.com" target="_blank" rel="noopener noreferrer">splashanimator.com</a></dd>
    <dt>Git repository</dt>
    <dd>Link coming soon</dd>
  </dl>
  <section aria-labelledby="license-title">
    <h3 id="license-title">Licensing</h3>
    {#if license.claims}
      {@const claims = license.claims}
      <dl>
        {#if claims.name}<dt>Licensed to</dt><dd>{claims.name}</dd>{/if}
        {#if claims.company_name}<dt>Company</dt><dd>{claims.company_name}</dd>{/if}
        <dt>Email</dt><dd>{claims.email}</dd>
      </dl>
    {:else}
      <p class="unlicensed">Unlicensed</p>
    {/if}
  </section>
  <button type="button" onclick={onregister}>Register…</button>
</dialog>

<style>
  dialog.dialog {
    position: fixed;
    box-sizing: border-box;
    width: min(480px, calc(100vw - 32px));
    color: inherit;
  }
  dialog::backdrop {
    background: #11151cbf;
    backdrop-filter: blur(4px);
  }
  a {
    color: var(--accent-text);
  }
  section { overflow-wrap: anywhere; }
  .unlicensed { color: #ff8585; font-weight: 600; }
</style>
