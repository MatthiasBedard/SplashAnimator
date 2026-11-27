<script lang="ts">
  import { setContext, tick, type Snippet } from 'svelte';
  import { PANEL_CONTEXT, PanelRegistry } from './panel-registry.svelte';
  import {
    PANEL_CATALOG,
    activatePanel,
    panelOrder,
    separatePanel,
    tabPanelWith,
    togglePanel,
    visiblePanelGroups,
    type PanelId,
    type PanelLayout,
  } from './panel-layout';
  let {
    layout,
    change,
    children,
  }: { layout: PanelLayout; change: (value: PanelLayout) => void; children: Snippet } = $props();
  const registry = new PanelRegistry();
  let dock: HTMLDivElement;
  let openOptions: { trigger: HTMLElement; details: HTMLDetailsElement; menu: HTMLElement } | undefined;
  setContext(PANEL_CONTEXT, registry);
  let groups = $derived(
    visiblePanelGroups(
      layout,
      registry.panels.map((p) => p.id),
    ),
  );
  const title = (id: PanelId) => PANEL_CATALOG.find(([key]) => key === id)![1];
  function positionOptions() {
    if (!openOptions) return;
    const { menu, trigger } = openOptions;
    const anchor = trigger.getBoundingClientRect();
    const sidebar = trigger.closest('.inspector')?.getBoundingClientRect();
    if (!anchor.height || sidebar && (anchor.bottom <= sidebar.top || anchor.top >= sidebar.bottom)) {
      closeOptions();
      return;
    }
    const edge = 8, gap = 4;
    const { clientWidth, clientHeight } = document.documentElement;
    const left = anchor.right - menu.offsetWidth;
    const below = anchor.top + 28, above = anchor.top - gap - menu.offsetHeight;
    const top = below + menu.offsetHeight <= clientHeight - edge || above < edge ? below : above;
    menu.style.left = `${Math.max(edge, Math.min(left, clientWidth - edge - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(edge, Math.min(top, clientHeight - edge - menu.offsetHeight))}px`;
  }
  function toggleOptions(event: MouseEvent) {
    const trigger = event.currentTarget as HTMLElement;
    const details = trigger.closest('details');
    const menu = details?.querySelector<HTMLElement>('.dock-options-menu');
    if (!details || !menu) return;
    event.preventDefault();
    const sameMenu = openOptions?.menu === menu;
    closeOptions();
    if (sameMenu) return;
    details.open = true;
    menu.showPopover();
    openOptions = { trigger, details, menu };
    positionOptions();
  }
  function dismissOutsideOptions(event: PointerEvent) {
    if (!openOptions) return;
    const path = event.composedPath();
    if (!path.includes(openOptions.trigger) && !path.includes(openOptions.menu)) closeOptions();
  }
  function dismissOptionsOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !openOptions?.menu.matches(':popover-open')) return;
    event.preventDefault();
    event.stopPropagation();
    closeOptions(true);
  }
  function closeOptions(restoreFocus = false) {
    if (!openOptions) return;
    const { trigger, details, menu } = openOptions;
    openOptions = undefined;
    if (menu.matches(':popover-open')) menu.hidePopover();
    details.open = false;
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  async function restructurePanel(id: PanelId, next: PanelLayout) {
    closeOptions();
    change(next);
    await tick();
    const header = dock?.querySelector<HTMLElement>(`[data-panel-header="${id}"]`);
    const control = header?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      header?.querySelector<HTMLElement>('.dock-options summary');
    control?.focus();
  }
  function tabKey(event: KeyboardEvent, panels: PanelId[], current: PanelId) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = panels.indexOf(current),
      next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? panels.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length;
    change(activatePanel(layout, panels[next]));
    document.getElementById(`dock-tab-${panels[next]}`)?.focus();
  }
</script>

<svelte:window onresize={positionOptions} onscrollcapture={positionOptions}
  onpointerdowncapture={dismissOutsideOptions} onkeydowncapture={dismissOptionsOnEscape} />
{@render children()}
<div class="dock-stack" bind:this={dock}>
  {#each groups as group (group.id)}
    <div
      class="dock-header"
      style:order={panelOrder(group.panels) * 2}
      data-panel-header={group.active}
    >
      {#if group.panels.length > 1}
        <div class="dock-tabs" role="tablist" aria-label="Property panels">
          {#each group.panels as id}
            <button
              id={`dock-tab-${id}`}
              role="tab"
              aria-selected={group.active === id}
              aria-controls={`dock-body-${id}`}
              tabindex={group.active === id ? 0 : -1}
              onclick={() => change(activatePanel(layout, id))}
              onkeydown={(event) => tabKey(event, group.panels, id)}>{title(id)}</button
            >
          {/each}
        </div>
      {/if}
      <div class="dock-title">
        <h3 aria-label={registry.panels.find((p) => p.id === group.active)?.heading}>
          <button
            aria-label={`Collapse ${title(group.active)} panel`}
            aria-expanded={!layout.collapsed.includes(group.active)}
            aria-controls={`dock-body-${group.active}`}
            onclick={() => change(togglePanel(layout, group.active, 'collapsed'))}
            ><span aria-hidden="true">{layout.collapsed.includes(group.active) ? '▸' : '▾'}</span>
            {registry.panels.find((p) => p.id === group.active)?.heading}</button
          >
        </h3>
        {#key group.active}
          <details class="dock-options">
            <summary aria-label={`Panel options ${title(group.active)}`}
              onclick={toggleOptions}>⋯</summary>
            <div id={`dock-options-${group.active}`} class="dock-options-menu" popover="manual"
              role="group" aria-label={`${title(group.active)} panel options`}>
              <label
                >Tab with<select
                  aria-label={`Tab ${title(group.active)} with`}
                  value=""
                  onchange={(event) => {
                    const target = event.currentTarget.value as PanelId;
                    if (target) void restructurePanel(group.active, tabPanelWith(layout, group.active, target));
                    else closeOptions();
                  }}
                  ><option value="" disabled>Choose panel…</option
                  >{#each PANEL_CATALOG as [id, label]}{#if id !== group.active}<option value={id}
                        >{label}</option
                      >{/if}{/each}</select
                ></label
              >
              <button
                disabled={!layout.groups.some((g) => g.panels.includes(group.active))}
                onclick={() => void restructurePanel(group.active, separatePanel(layout, group.active))}>Separate panel</button
              >
              <button
                onclick={() => {
                  closeOptions();
                  change(togglePanel(layout, group.active, 'hidden'));
                }}>Hide panel</button
              >
            </div>
          </details>
        {/key}
      </div>
    </div>
  {/each}
  <!-- Keep bodies under one stable parent: grouping and tab switches must not remount drafts. -->
  {#each registry.panels as panel (panel.id)}
    {@const group = groups.find((g) => g.panels.includes(panel.id))}
    {@const shown = !!group && group.active === panel.id && !layout.collapsed.includes(panel.id)}
    <section
      id={`dock-body-${panel.id}`}
      class="property-section dock-body"
      style:order={group ? panelOrder(group.panels) * 2 + 1 : 999}
      hidden={!shown}
      inert={!shown || panel.blocked}
      role={group && group.panels.length > 1 ? 'tabpanel' : 'region'}
      aria-label={title(panel.id)}
      aria-labelledby={group && group.panels.length > 1 ? `dock-tab-${panel.id}` : undefined}
    >
      {@render panel.children()}
    </section>
  {/each}
  {#if !groups.length}<p class="hint dock-empty">
      No panels visible for this selection. Use Window to show panels or reset the layout.
    </p>{/if}
</div>
