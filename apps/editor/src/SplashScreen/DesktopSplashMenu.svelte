<script lang="ts">
  import type { Readable } from 'svelte/store';
  import { applicationMenuNames } from '../application-menu';
  import { desktopUpdate } from '../desktop-update';
  import DesktopWindowControls from '../DesktopWindowControls.svelte';
  import { license } from '../license.svelte';
  import splashMark from '../logo_s.svg';
  import '../style.css';
  let { updateReady, openUpdate }: { updateReady: Readable<boolean>; openUpdate: () => void } = $props();
</script>

<nav class="menubar desktop-menubar" aria-label="Application menu">
  <div class="brand" role="img" aria-label="Splash Animator">
    <img class="brand-mark" src={splashMark} alt="" /><span>SPLASH</span>
  </div>
  {#each applicationMenuNames as name}
    <button type="button" disabled>{name}</button>
  {/each}
  <div class="menu-drag-region" data-tauri-drag-region aria-hidden="true"></div>
  {#if $desktopUpdate.release?.ticket}
    <button type="button" class="update-available" disabled={!$updateReady} onclick={openUpdate}>Update Available</button>
  {/if}
  {#if license.claims}
    <button type="button" class="publish" disabled><span aria-hidden="true">↗</span> Export</button>
  {:else}
    <button type="button" class="publish register-prompt" disabled>Register Splash Animator</button>
  {/if}
  <DesktopWindowControls
    reportError={(error) => console.error('Desktop window control failed', error)}
  />
</nav>
