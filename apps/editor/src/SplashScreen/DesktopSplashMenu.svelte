<script lang="ts">
  import { applicationMenuNames } from '../application-menu';
  import DesktopWindowControls from '../DesktopWindowControls.svelte';
  import { license } from '../license.svelte';
  import splashMark from '../logo_s.svg';
  import '../style.css';
</script>

<nav class="menubar desktop-menubar" aria-label="Application menu">
  <div class="brand" role="img" aria-label="Splash Animator">
    <img class="brand-mark" src={splashMark} alt="" /><span>SPLASH</span>
  </div>
  {#each applicationMenuNames as name}
    <button type="button" disabled>{name}</button>
  {/each}
  <div class="menu-drag-region" data-tauri-drag-region aria-hidden="true"></div>
  {#if license.claims}
    <button type="button" class="publish" disabled>↗ Export HTML</button>
  {:else}
    <button type="button" class="publish register-prompt" disabled>Register Splash Animator</button>
  {/if}
  <DesktopWindowControls
    reportError={(error) => console.error('Desktop window control failed', error)}
  />
</nav>
