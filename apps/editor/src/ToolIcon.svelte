<script lang="ts">
  import type { Tool } from '../../../packages/interaction/src';
  let { tool }: { tool: Tool } = $props();
</script>

<svg
  aria-hidden="true"
  focusable="false"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  {#if tool === 'select' || tool === 'subselect'}
    <path
      d="M5 2.5v16l4.3-4.4 4.1 7.4 3.2-1.8-4.1-7.2H19Z"
      fill={tool === 'select' ? 'currentColor' : 'none'}
      stroke-width="1.4"
    />
  {:else if tool === 'lasso'}
    <path
      d="M7 16c-3.2-1-4.8-3-4-6C4 5.8 9 3.8 14 5s7.3 4 6 7.4c-1 2.7-4.4 4.5-8 4.8-3.8.4-6.7-.3-6.7-2.5 0-1.4 2.2-1.8 3.4-.4C11 17.2 7 20 3 21"
    />
  {:else if tool === 'pen'}
    <path d="m4 20 3-11 9-5 4 4-5 9Z" /><path d="m4 20 6-6m4-10 6 6" />
    <circle cx="11.5" cy="12.5" r="1.8" />
  {:else if tool === 'text'}
    <path d="M4 7V4h16v3M12 4v16m-4 0h8" />
  {:else if tool === 'line'}
    <path d="m4 20 16-16" stroke-width="2" />
  {:else if tool === 'rectangle' || tool === 'rounded'}
    <rect x="3.5" y="4.5" width="17" height="15" rx={tool === 'rounded' ? 4 : 0} />
  {:else if tool === 'ellipse'}
    <ellipse cx="12" cy="12" rx="9" ry="7.5" />
  {:else if tool === 'star'}
    <path d="m12 2 3 6.3 7 .9-5.1 4.9 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.2l7-.9Z" />
  {:else if tool === 'path'}
    <path d="m4 15 11-11a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L9 20l-6 1Z" />
    <path d="m13 6 5 5M4 15l5 5m-6 1 1-4m3 0 9-9" />
  {:else if tool === 'brush'}
    <path d="M13.5 13.5 21 4a1.8 1.8 0 0 0-2.5-2.5L9 9" /><path d="m8 9 7 7-3 3-7-7z" />
    <path d="M5 12c-3 2-1 5-4 8 4 2 9 1 11-2m-8 1 3-3" />
  {:else if tool === 'bucket'}
    <path d="m3 10 6-6 8 8-6 6Z" fill="currentColor" fill-opacity=".12" />
    <path d="m7 6-2-2a1.8 1.8 0 0 1 2.5-2.5L11 5m-6 7h12" />
    <path
      d="M19.5 13c-.9 1.8-2.5 3.5-2.5 5.4a2.5 2.5 0 0 0 5 0c0-1.9-1.6-3.6-2.5-5.4Z"
      fill="currentColor"
      stroke-width="1.2"
    />
  {:else if tool === 'ink'}
    <path d="M9 3h6v5l3 3v9H6v-9l3-3Zm0 5h6M9 1h6" />
    <path d="M12 11c-.8 1.2-2 2.7-2 4a2 2 0 0 0 4 0c0-1.3-1.2-2.8-2-4Z" fill="currentColor" />
  {:else if tool === 'eyedropper'}
    <path d="m14 6-9 9-1.5 5.5L9 19l9-9m-11 4 3 3" />
    <path d="m14 4 6 6" stroke-width="2.8" />
    <path d="m15 5 1.5-2a2.8 2.8 0 0 1 4 4L19 9" fill="currentColor" fill-opacity=".18" />
  {:else if tool === 'eraser'}
    <path d="m3 14 9-10a1.5 1.5 0 0 1 2-.1l7 6.5a1.5 1.5 0 0 1 .1 2L13 21H9Z" />
    <path d="m8 8 9 8m-8 5h13" />
    <path d="m8 8 4-4 9 8-4 4Z" fill="currentColor" fill-opacity=".2" stroke="none" />
  {:else if tool === 'hand'}
    <path
      d="M8 13V6a1.5 1.5 0 0 1 3 0v5m0-1V3.5a1.5 1.5 0 0 1 3 0V10m0 0V5a1.5 1.5 0 0 1 3 0v7m0-2V8a1.5 1.5 0 0 1 3 0v6c0 5-3 8-7 8h-1c-2 0-3-1-4-2l-4-5a1.7 1.7 0 0 1 2.5-2.3L8 14"
    />
  {:else if tool === 'zoom'}
    <circle cx="10" cy="10" r="6.5" /><path d="m15 15 6 6M7 10h6m-3-3v6" />
  {:else if tool === 'gradient'}
    <g stroke="none" fill="currentColor">
      <path d="M6 6h2.4v12H6Z" fill-opacity=".12" /><path
        d="M8.4 6h2.4v12H8.4Z"
        fill-opacity=".3"
      />
      <path d="M10.8 6h2.4v12h-2.4Z" fill-opacity=".5" /><path
        d="M13.2 6h2.4v12h-2.4Z"
        fill-opacity=".7"
      />
      <path d="M15.6 6H18v12h-2.4Z" />
    </g>
    <path d="M4.5 4.5h15v15h-15Z" stroke-width="1.3" />
    <g fill="currentColor" stroke="none"
      ><rect x="2.5" y="2.5" width="4" height="4" /><rect
        x="17.5"
        y="2.5"
        width="4"
        height="4"
      /><rect x="2.5" y="17.5" width="4" height="4" /><rect
        x="17.5"
        y="17.5"
        width="4"
        height="4"
      /></g
    >
  {/if}
</svg>
