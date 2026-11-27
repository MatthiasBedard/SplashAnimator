<script lang="ts">
  import ProjectCode from './ProjectCode.svelte';
  import { onMount } from 'svelte';
  import type { FileOperation } from './script-workspace';
  let { path, operate }: { path: string; operate: FileOperation } = $props();
  let contents = $state(''),
    status = $state('Loading…');
  onMount(() => {
    let alive = true;
    void operate({ op: 'read', path }).then(
      (value) => {
        if (alive && typeof value === 'string') {
          contents = value;
          status = '';
        }
      },
      (error) => {
        if (alive) status = String(error);
      },
    );
    return () => {
      alive = false;
    };
  });
</script>

<div class="bar">{path} · Read-only</div>
{#if status}<p role="status">{status}</p>{:else}<div class="surface"><ProjectCode readOnly tab={{path,text:contents,original:contents}} /></div>{/if}

<style>
  .bar {
    padding: 4px 8px;
    color: #b5bfce;
    font-size: 11px;
  }
  .surface { position: relative; flex: 1; min-height: 50px; }
</style>
