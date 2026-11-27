<script module lang="ts">
  export type HierarchyTarget={destination:string[];anchor?:string;side?:'before'|'after'};
  export type HierarchyDestination={value:string;label:string;path:string[];anchors:{id:string;label:string}[]};
</script>
<script lang="ts">
  let {entries,disabled,dragging,onstart,onend,onover,ondrop,onplace,
    selectionChoices=[],selectionIds=[],selectionDisabled=false,onselection}:{
    entries:HierarchyDestination[];disabled:boolean;dragging:boolean;
    selectionChoices?:{id:string;label:string}[];selectionIds?:string[];selectionDisabled?:boolean;
    onselection?:(ids:string[])=>void;
    onstart:(event:DragEvent)=>void;onend:()=>void;onover:(event:DragEvent)=>void;
    ondrop:(event:DragEvent,target:HierarchyTarget)=>void;onplace:(target:HierarchyTarget)=>void;
  }=$props();
</script>
<details class="hierarchy-placement">
  <summary>Drag or place selected units</summary>
  {#if onselection}
    <fieldset class="unit-choices">
      <legend>Units to move</legend>
      {#each selectionChoices as choice (choice.id)}
        <label><input type="checkbox" aria-label={'Move hierarchy unit '+choice.id}
          disabled={selectionDisabled} checked={selectionIds.includes(choice.id)}
          onchange={event=>onselection!(event.currentTarget.checked
            ? [...selectionIds.filter(id=>id!==choice.id),choice.id]
            : selectionIds.filter(id=>id!==choice.id))} />{choice.label}</label>
      {/each}
      <p>{selectionIds.length} units selected for placement and the explicit hierarchy transform command. Other property controls edit the active artwork item.</p>
    </fieldset>
  {/if}
  <button disabled={disabled} draggable={!disabled} ondragstart={onstart} ondragend={onend}>Drag selected hierarchy units</button>
  <p>Drop into a group, or above/below a complete sibling unit. Click a placement for keyboard access.</p>
  <p class="drag-status" role="status">{dragging ? "Moving selected hierarchy units. Escape cancels." : ""}</p>
  <div class="destinations">
    {#each entries as entry (entry.value)}
      <fieldset>
        <legend>{entry.label}</legend>
        <button disabled={disabled} aria-label={'Place selection into '+entry.label}
          onclick={()=>onplace({destination:entry.path})} ondragover={onover}
          ondrop={event=>ondrop(event,{destination:entry.path})}>Into {entry.label}</button>
        {#each entry.anchors as anchor (anchor.id)}
          <div class="anchor">
            <span>{anchor.label}</span>
            <button disabled={disabled} aria-label={'Place selection below '+anchor.id+' in '+entry.label}
              onclick={()=>onplace({destination:entry.path,anchor:anchor.id,side:'before'})}
              ondragover={onover} ondrop={event=>ondrop(event,{destination:entry.path,anchor:anchor.id,side:'before'})}>Below</button>
            <button disabled={disabled} aria-label={'Place selection above '+anchor.id+' in '+entry.label}
              onclick={()=>onplace({destination:entry.path,anchor:anchor.id,side:'after'})}
              ondragover={onover} ondrop={event=>ondrop(event,{destination:entry.path,anchor:anchor.id,side:'after'})}>Above</button>
          </div>
        {/each}
      </fieldset>
    {/each}
  </div>
</details>
<style>
  .unit-choices{max-height:180px;overflow:auto}
  .unit-choices label{display:block;overflow-wrap:anywhere}
  .drag-status{height:3em;margin:4px 0}
  .destinations{max-height:280px;overflow:auto}
  fieldset{min-width:0;margin:8px 0;border:1px solid #434752}
  legend,button{max-width:100%;overflow-wrap:anywhere}
  .anchor{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:5px}
  .anchor span{flex:1 1 5em;min-width:0;overflow-wrap:anywhere}
</style>
