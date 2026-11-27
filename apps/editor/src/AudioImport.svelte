<script lang="ts">
 import {onDestroy,tick,untrack} from 'svelte';
 import {audioImportAccept} from '../../../packages/audio/src/import-formats';
 let {importFile,initialFile}:{initialFile?:File;importFile:(file:File,signal:AbortSignal)=>Promise<void>}=$props();
 let file=$state<File|undefined>(untrack(()=>initialFile)),running=$state(false),message=$state(''),error=$state('');
 let controller:AbortController|undefined,alive=true;
 let input:HTMLInputElement,importButton:HTMLButtonElement;
 let cancelButton=$state<HTMLButtonElement>();
 onDestroy(()=>{alive=false;controller?.abort();});
 async function run(){if(!file||running)return;const job=new AbortController();controller=job;running=true;error='';message='Preparing and saving audio…';
  const followsImport=document.activeElement===importButton;
  const dialog=importButton.closest('dialog');
  if(followsImport)void tick().then(()=>{
   const active=document.activeElement;
   if(alive&&controller===job&&(active===importButton||active===document.body||active===dialog))cancelButton?.focus();
  });
  try{await importFile(file,job.signal);message='Audio asset imported. Use Edit audio clips to place it on the timeline.';file=undefined;if(alive)input.value='';}
  catch(e){error=String(e);message='Import did not update the project.';}
  finally{
   const active=document.activeElement;
   const restore=followsImport&&(active===cancelButton||active===importButton||active===document.body||active===dialog);
   running=false;controller=undefined;
   if(restore){
    await tick();
    if(alive&&(document.activeElement===active||document.activeElement===document.body||document.activeElement===dialog))
     (file?importButton:input).focus();
   }
  }
 }
</script>
<h2>Import audio</h2>
<p>Choose a mono or stereo WAV (16-bit PCM), MP3, or Ogg Opus file, up to 64 MiB. MP3 and Opus are converted to WAV in the project folder.</p>
<label>Audio file <input bind:this={input} type="file" accept={audioImportAccept} disabled={running} onchange={e=>{file=e.currentTarget.files?.[0];message='';error='';}} /></label>
{#if file}<p>Selected: {file.name}</p>{/if}
<button data-import-audio bind:this={importButton} disabled={!file||running} onclick={run}>Import audio asset</button>
{#if running}<button bind:this={cancelButton} onclick={()=>controller?.abort()}>Cancel audio import</button>{/if}
<p role="status">{message}</p>{#if error}<p role="alert">{error}</p>{/if}
<style>p{max-width:580px}label{display:block;margin:12px 0}button{margin-right:8px}</style>
