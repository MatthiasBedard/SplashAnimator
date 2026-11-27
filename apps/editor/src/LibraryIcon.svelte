<script lang="ts">
  let { kind }: { kind: string } = $props();
</script>

<svg
  width="18"
  height="18"
  viewBox="0 0 20 20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if kind === 'bitmap'}<rect x="2" y="3" width="16" height="14" rx="2" /><circle
      cx="6"
      cy="7"
      r="1"
    /><path d="m3 15 5-5 3 3 3-4 4 6" />
  {:else if kind === 'movie'}<rect x="2" y="3" width="16" height="14" rx="2" /><path
      d="M5 3v14M15 3v14M2 7h3M2 13h3M15 7h3M15 13h3"
    /><path d="m8 7 4 3-4 3Z" fill="currentColor" />
  {:else if kind === 'button'}<rect x="2" y="5" width="16" height="10" rx="3" /><path
      d="m9 8 4 3-2 .5-.5 2.5Z"
    />
  {:else if kind === 'audio'}<path d="M7 14V4l9-2v10M7 7l9-2" /><ellipse
      cx="4"
      cy="14"
      rx="3"
      ry="2"
    /><ellipse cx="13" cy="12" rx="3" ry="2" />
  {:else if kind === 'folder'}<path d="M2 5h6l2 2h8v10H2Z" />
  {:else if kind === 'filter'}<path d="M2 5h16M2 10h16M2 15h16" /><circle
      cx="7"
      cy="5"
      r="2"
      fill="var(--panel-bg,#2c2f38)"
    /><circle cx="13" cy="10" r="2" fill="var(--panel-bg,#2c2f38)" /><circle
      cx="7"
      cy="15"
      r="2"
      fill="var(--panel-bg,#2c2f38)"
    />
  {:else}<path d="m10 2 8 8-8 8-8-8Z" /><path d="m7 7 6 6m0-6-6 6" />{/if}
</svg>
