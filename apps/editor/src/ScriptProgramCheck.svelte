<script lang="ts">
  import {onDestroy,onMount} from 'svelte';
  import type {ScriptTimelineConfig} from '../../../packages/scripting/src/timeline';
  import type {ScriptFrameSource} from '../../../packages/scripting/src/session';
  import type {ProgramCompilation} from '../../../packages/scripting/src/compile-program';
  import {wrapDialogTab} from './dialog-focus';
  let {config,sources,openSource,dismiss}:{config:ScriptTimelineConfig;sources:ScriptFrameSource[];openSource:(frame:number,location?:{line:number;column:number})=>void;dismiss:()=>void}=$props();
  let dialog:HTMLDialogElement,action:HTMLButtonElement;
  onMount(()=>{
    dialog.showModal();
    action.focus({preventScroll:true});
  });
  let controller:AbortController|undefined;
  let busy=$state(false),status=$state(''),result=$state<ProgramCompilation|undefined>();
  function cancel(){controller?.abort();controller=undefined;busy=false;}
  onDestroy(cancel);
  async function check(){
    cancel();result=undefined;const job=new AbortController();controller=job;busy=true;status='Checking saved frame sources…';
    try{
      const {compileScriptProgram}=await import('../../../packages/scripting/src/compile-program');
      if(job.signal.aborted)return;
      const output=await compileScriptProgram(config,sources,{signal:job.signal});
      if(controller!==job)return;
      // The checking panel retains diagnostics only, never an executable program.
      result={diagnostics:output.diagnostics,checkedFrames:output.checkedFrames,totalFrames:output.totalFrames};
      status=output.diagnostics.length?`${output.diagnostics.length} diagnostics. Checked ${output.checkedFrames} of ${output.totalFrames} saved bodies.`:
        `All ${output.totalFrames} saved bodies passed. Source was not executed.`;
    }catch(error){if(controller===job)status=error instanceof Error?error.message:'Program check failed.';}
    finally{if(controller===job){controller=undefined;busy=false;}}
  }
  function open(frame:number,location:{line:number;column:number}){try{openSource(frame,location);}catch(error){status=error instanceof Error?error.message:'Source changed.';}}
</script>

<dialog class="dialog script-preview-dialog" aria-labelledby="saved-source-check-title" bind:this={dialog}
  onkeydown={wrapDialogTab} oncancel={event=>{event.preventDefault();dismiss();}}>
  <button class="dialog-close" aria-label="Close dialog" onclick={dismiss}>×</button>
  <h2 id="saved-source-check-title">Check saved frame sources</h2>
  <p>Checks the {sources.length} saved main-frame bodies captured when this panel opened. Unapplied drafts are not included. This does not execute scripts.</p>
  <button bind:this={action} onclick={()=>{
    if(busy){cancel();status='Program check cancelled.';}
    else void check();
  }}>{busy?'Cancel program check':'Check all saved sources'}</button>
  <p role="status">{status}</p>
  {#if result?.diagnostics.length}<ul>
    {#each result.diagnostics as diagnostic,index (index)}
      <li><button onclick={()=>open(diagnostic.frame,diagnostic)}>Frame {diagnostic.frame+1}, line {diagnostic.line}, column {diagnostic.column}: {diagnostic.message}</button></li>
    {/each}
  </ul>{/if}
</dialog>
<style>
  dialog{position:fixed;inset:0;margin:auto;width:min(548px,calc(100vw - 32px));color:inherit;}
  dialog::backdrop{background:#11151cbf;backdrop-filter:blur(4px);}
  p{font-size:13px;}ul{max-height:300px;overflow:auto;padding-left:18px;}
  li button{text-align:left;white-space:normal;}
</style>
