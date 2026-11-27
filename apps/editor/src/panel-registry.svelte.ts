import type { Snippet } from 'svelte';
import type { PanelId } from './panel-layout';
export const PANEL_CONTEXT = Symbol('property panels');
export interface PanelDefinition {
  id: PanelId;
  heading: string;
  children: Snippet;
  blocked: boolean;
}
export class PanelRegistry {
  panels = $state.raw<PanelDefinition[]>([]);
  register(panel: PanelDefinition) {
    this.panels = [...this.panels.filter((p) => p.id !== panel.id), panel];
    return () => {
      this.panels = this.panels.filter((p) => p !== panel);
    };
  }
}
