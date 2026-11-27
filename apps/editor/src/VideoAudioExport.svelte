<script lang="ts">
 import {onDestroy,untrack} from 'svelte';
 import {focusDialogFooter,showFocusedDialog,wrapDialogTab} from './dialog-focus';
 let {assets,automatic=false,save=false,summary,encoding,cancellable=true,message,failure,start,cancel,close}:{assets:{path:string;name:string}[];automatic?:boolean;save?:boolean;summary:string;encoding:boolean;cancellable?:boolean;message:string;failure:string;start:(files:Map<string,File>)=>Promise<void>;cancel:()=>void;close:()=>void}=$props();
 let files=$state<Record<string,File>>({});
 const ready=$derived(assets.every(a=>automatic||files[a.path]));
 let dialog=$state<HTMLDialogElement>();
 const release=untrack(()=>close);onDestroy(()=>release());
 $effect(()=>{if(encoding&&!cancellable)void focusDialogFooter(dialog);});
 async function run(){
  const job=start(new Map(Object.entries(files)));
  void focusDialogFooter(dialog);
  try{await job;}finally{await focusDialogFooter(dialog);}
 }
</script>
 <dialog class="panel" bind:this={dialog} use:showFocusedDialog aria-label={`${save?'Save':'Export'} WebM with project audio`}
  onkeydown={wrapDialogTab} oncancel={event=>{event.preventDefault();close();}}>
  <header><h2>{save?'Save':'Export'} WebM with project audio</h2><button aria-label="Close dialog" onclick={close}>Close</button></header>
  <p>{summary}</p>
  <p>{automatic?'Saved project WAVs will be loaded. Choose a file to override one for this output.':'Choose each referenced WAV for this output. Files stay separate from project artwork and are checked against saved audio metadata.'}</p>
  {#each assets as asset}<label>{asset.name}<small>{asset.path}</small><input type="file" accept=".wav,audio/wav" aria-label={`WAV for ${asset.path}`} disabled={encoding} onchange={e=>{const file=e.currentTarget.files?.[0];if(file)files[asset.path]=file;else delete files[asset.path];}} /></label>{/each}
  {#if failure}<p role="alert">{failure}</p>{/if}
  <p role="status">{message}</p>
  <footer>{#if encoding}{#if cancellable}<button onclick={cancel}>{save?'Cancel audio-video save':'Cancel audio-video encoding'}</button>{:else}<span>Finishing file. Saving continues if you close this dialog.</span>{/if}{:else}<button disabled={!ready} onclick={run}>{save?'Save':'Export'} WebM with audio</button>{/if}</footer>
 </dialog>
<style>
 .panel::backdrop{background:#0009}
 .panel{position:fixed;inset:0;box-sizing:border-box;background:#25272d;color:#eee;border:1px solid #60636d;border-radius:8px;padding:20px;width:min(642px,calc(100vw - 32px));max-height:85vh;overflow:auto}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h2{font-size:18px;margin:0}p{font-size:13px;line-height:1.5}label{display:block;margin:14px 0;font-size:13px}small{display:block;color:#b9bdc8;margin:4px 0}input{display:block;max-width:100%}footer{display:flex;justify-content:flex-end;margin-top:16px}button{background:#393c46;color:#fff;border:1px solid #777c8b;border-radius:4px;padding:7px 12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#ffb8aa}
</style>
