<script lang="ts">
  let { kind, active = true }: { kind: 'outline' | 'hide' | 'lock'; active?: boolean } = $props();
</script>

<svg
  width="14"
  height="14"
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if kind === 'outline'}
    <rect x="2.5" y="2.5" width="11" height="11" fill={active ? 'none' : 'currentColor'} />
  {:else if kind === 'hide'}
    <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" />
    <circle cx="8" cy="8" r="2" />
    {#if !active}<path d="M2 2l12 12" />{/if}
  {:else}
    <rect x="3.5" y="7" width="9" height="7" rx="1" />
    <path d={active ? 'M5 7V4a3 3 0 0 1 6 0v3' : 'M5 7V4a3 3 0 0 1 6 0'} />
  {/if}
</svg>
