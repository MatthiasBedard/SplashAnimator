<script lang="ts">
  import {onDestroy,onMount,tick} from 'svelte';
  import type {FrameDiagnostic} from '../../../packages/scripting/src/compile';
  import {isScriptSaveShortcut} from './script-workspace';
  let {source=$bindable(''),frameNumber,scope='main',savedSource,shouldFocus=()=>true,apply,persist,remove,selection,panel=false}:{source:string;panel?:boolean;selection?:{source:string;line:number;column:number};frameNumber?:number;scope?:'main'|'symbol';savedSource?:string;shouldFocus?:()=>boolean;apply?:(source:string)=>void|Promise<void>;persist?:(source:string)=>void|Promise<void>;remove?:()=>void|Promise<void>}=$props();
  let codeContainer=$state<HTMLDivElement>();
  let mode=$state<'loading'|'code'|'error'|'retrying'>('loading'),codeStatus=$state(''),composing=$state(false);
  let editor:ReturnType<typeof import('./source-code-editor').createSourceCodeEditor>|undefined;
  let alive=true,editorGeneration=0;
  const editorOwner:{source:string;frame:number|undefined}={source:'',frame:undefined};
  let savedInput='', leftDuringComposition=false;
  let saveFeedback=$state('');
  let dispatchingSave=false;
  let pendingSave:{value:string;done:Promise<boolean>}|undefined;
  export function isComposing(){return composing;}
  export function flush(){
    if(!persist||!editor)return true;
    if(dispatchingSave)return false;
    if(composing){leftDuringComposition=true;return false;}
    const value=source,generation=editorGeneration;
    if(pendingSave?.value===value)return pendingSave.done;
    if(!pendingSave&&value===savedInput)return true;
    dispatchingSave=true;
    saveFeedback='Saving frame changes…';
    try {
      const result=persist(value);
      if(!result){finishSave(value,generation);return source===value;}
      const done=result.then(()=>{
        finishSave(value,generation);
        return alive&&generation===editorGeneration&&source===value;
      }).catch(error=>{
        reportSaveFailure(error,value,generation);
        return false;
      }).finally(()=>{
        if(pendingSave?.done===done)pendingSave=undefined;
      });
      pendingSave={value,done};
      return done;
    } catch(error){reportSaveFailure(error,value,generation);return false;}
    finally{dispatchingSave=false;}
  }
  export function discardDraft(){source=savedInput;}
  function finishSave(value:string,generation:number){
    if(!alive||generation!==editorGeneration)return;
    savedInput=value;
    if(source===value)
      saveFeedback=scope==='symbol'?'Frame changes saved to the symbol draft.':'Frame changes applied.';
  }
  function reportSaveFailure(error:unknown,value:string,generation:number){
    if(alive&&generation===editorGeneration&&source===value)
      saveFeedback='Frame changes remain unsaved. '+(error instanceof Error?error.message:String(error));
  }
  function leaveEditor(event:FocusEvent){
    if(!(event.relatedTarget instanceof Node)||!codeContainer?.contains(event.relatedTarget))void flush();
  }
  function leaveWindow(){
    if(codeContainer?.contains(document.activeElement))void flush();
  }
  function saveShortcut(event:KeyboardEvent){
    if(panel||!persist||!isScriptSaveShortcut(event))return;
    event.preventDefault();
    event.stopPropagation();
    if(!event.repeat&&!event.isComposing&&!composing)void flush();
  }
  $effect(()=>{
    const current=source,frame=frameNumber,target=selection;
    if(mode==='code'&&editor){
      if(editorOwner.source!==current||editorOwner.frame!==frame){void openCode();return;}
      if(target&&target.source===current)editor.locate(target);
    }
  });
  async function openCode(retry?: HTMLButtonElement){
    const owned=++editorGeneration;
    editor?.dispose();editor=undefined;
    invalidate();composing=false;mode=retry?'retrying':'loading';codeStatus='Loading Monaco…';
    try{
      const module=await import('./source-code-editor');await tick();
      if(!alive||owned!==editorGeneration)return;
      if(!codeContainer)throw new Error('Code editor view is unavailable.');
      editorOwner.source=source;editorOwner.frame=frameNumber;
      savedInput=savedSource??source;leftDuringComposition=false;pendingSave=undefined;
      saveFeedback=persist&&source!==savedInput?'Frame changes pending.':'';
      editor=module.createSourceCodeEditor(codeContainer,source,value=>{
        editorOwner.source=value;source=value;invalidate();
        if(persist)saveFeedback=value!==savedInput||pendingSave?'Frame changes pending.':'';
      },message=>{if(alive&&owned===editorGeneration)codeStatus=message;},active=>{
        if(!alive||owned!==editorGeneration)return;
        composing=active;
        if(active)invalidate();
        else if(leftDuringComposition){leftDuringComposition=false;void flush();}
      });
      mode='code';
      if(codeContainer.getClientRects().length&&(retry ? retry.ownerDocument.activeElement===retry : shouldFocus()))editor.focus();
      if(selection&&selection.source===source)editor.locate(selection);
    }catch(error){if(alive&&owned===editorGeneration){editor?.dispose();editor=undefined;mode='error';codeStatus='Monaco could not load. '+String(error);}}
  }
  let controller:AbortController|undefined;
  let busy=$state(false),status=$state(''),diagnostics=$state<FrameDiagnostic[]>([]);
  function invalidate(){
    controller?.abort();controller=undefined;busy=false;status='';diagnostics=[];
  }
  onDestroy(()=>{alive=false;editorGeneration++;editor?.dispose();editor=undefined;invalidate();});
  async function check(){
    if(composing)return;
    invalidate();
    const job=new AbortController();controller=job;busy=true;
    status='Checking TypeScript…';
    const snapshot=source;
    try{
      const {compileFrameSourceAsync}=await import('../../../packages/scripting/src/compile-async');
      if(job.signal.aborted)return;
      const result=await compileFrameSourceAsync(snapshot,{signal:job.signal});
      if(controller!==job)return;
      diagnostics=result.diagnostics;
      status=diagnostics.length?`${diagnostics.length} diagnostic${diagnostics.length===1?'':'s'}.`:'No type errors. Source was not executed.';
    }catch(error){
      if(controller===job)status=error instanceof Error?error.message:'Compilation failed.';
    }finally{
      if(controller===job){controller=undefined;busy=false;}
    }
  }
  async function commit(removing=false){
    if(composing)return;
    invalidate();
    const value=source,generation=editorGeneration;
    try{
      if(removing){
        await remove?.();
        if(alive&&generation===editorGeneration){savedInput='';if(source===value)source='';}
      }else {await apply?.(value);if(alive&&generation===editorGeneration)savedInput=value;}
      saveFeedback='';
      status=scope==='symbol'?(removing?'Local frame source removed from the draft.':'Local frame source applied to the draft. Apply the symbol timeline to keep it in the project.'):(removing?'Frame source removed.':'Frame source applied. Save the project to keep it on disk.');}
    catch(error){status=error instanceof Error?error.message:'Could not update frame source.';}
  }
  function locate(location:{line:number;column:number}){
    editor?.locate(location);
  }
  onMount(()=>{void openCode();});
</script>

<svelte:window onblur={leaveWindow} />

{#if !panel}<h2>{frameNumber===undefined?'Check frame TypeScript':`TypeScript for ${scope} frame ${frameNumber}`}</h2>
{#if frameNumber===undefined}<p>Scratchpad only. Draft text stays here until you reload; it is not saved in the project or attached to a frame.</p>
{:else if scope==='symbol'}<p>Edits save to the symbol draft when you leave the code editor. Apply the symbol timeline to keep the draft in the project.</p>
{:else}<p>Edits save to the frame when you leave the code editor. Save the project to keep them on disk.</p>{/if}
<p>Use <code>timeline</code> for playback commands and <code>state</code> for JSON values. This checks types with ES5 built-ins; it does not run your code.</p>{/if}
<div class="code-editor" role="group" aria-label="Source code editor" bind:this={codeContainer} onfocusout={leaveEditor} onkeydowncapture={saveShortcut}></div>
{#if codeStatus}<p aria-label="Code editor status" aria-live="polite">{codeStatus}</p>{/if}
{#if mode==='error'||mode==='retrying'}<button type="button" aria-disabled={mode==='retrying'} onclick={event=>{if(mode==='error')void openCode(event.currentTarget);}}>Retry frame editor</button>{/if}
{#if mode==='code'}<p>Tab indents. Ctrl+M switches Tab to move focus; use Ctrl+Shift+M on macOS.</p>{/if}
<div class="actions">
  <button disabled={busy||composing||mode!=='code'} onclick={check}>Check TypeScript</button>
  {#if apply}<button title={persist?(saveFeedback||'Edits save when you leave the code editor. Use this to save now or retry.'):undefined}
    disabled={busy||composing||mode!=='code'} onclick={()=>commit()}>Apply frame source</button>{/if}
  {#if remove}<button disabled={busy||composing||mode!=='code'} onclick={()=>commit(true)}>Remove frame source</button>{/if}
  {#if busy}<button onclick={()=>{invalidate();status='Compilation cancelled.';}}>Cancel compilation</button>{/if}
</div>
{#if persist}<p class="save-feedback" aria-live="polite" aria-atomic="true" aria-label="Frame save status">{saveFeedback}</p>{/if}
<p role="status">{status}</p>
<ul>{#each diagnostics as diagnostic,index (index)}
  <li><button onclick={()=>locate(diagnostic)}>Line {diagnostic.line}, column {diagnostic.column}: {diagnostic.message}</button></li>
{/each}</ul>

<style>
  .code-editor{height:320px;min-width:0;border:1px solid #52586a;margin-top:8px;}
  .actions{display:flex;gap:8px;margin-top:10px;}
  .save-feedback{font-size:12px;margin:6px 0 0;}
  .save-feedback:empty{margin:0;}
  ul{max-height:180px;overflow:auto;padding-left:18px;}
  li button{text-align:left;white-space:normal;}
  p{font-size:13px;}
</style>
