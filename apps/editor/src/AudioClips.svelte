<script lang="ts">
 import {tick} from 'svelte';
 import {clone,type Project,type AudioClip} from '../../../packages/document/src';
 let {snapshot,apply}:{snapshot:Project;apply:(clips:AudioClip[])=>void}=$props();
 let clips=$state<AudioClip[]>([]),error=$state(''),status=$state('Changes stay in this draft until Apply.');
 let initialized=false;
 $effect(()=>{if(!initialized){clips=clone(snapshot.audioClips??[]);initialized=true;}});
 const assets=$derived(snapshot.assets.filter(a=>a.audio));
 let clipList:HTMLDivElement,addButton:HTMLButtonElement;
 async function add(){
   if(!assets.length||clips.length>=10000)return;
   const id=crypto.randomUUID();
   clips.push({id,assetId:assets[0].id,startFrame:0,offsetSamples:0,gain:1});
   status='Unapplied changes.';
   await tick();
   clipList?.querySelector<HTMLSelectElement>(`[data-audio-clip="${CSS.escape(id)}"] select`)?.focus();
 }
 async function remove(id:string){
   const index=clips.findIndex(clip=>clip.id===id);
   if(index<0)return;
   clips.splice(index,1);
   const next=clips[index]??clips[index-1];
   status='Unapplied changes.';
   await tick();
   const nextButton=next&&clipList?.querySelector<HTMLButtonElement>(`[data-audio-clip="${CSS.escape(next.id)}"] button`);
   (nextButton??addButton)?.focus();
 }
 function commit(){try{apply($state.snapshot(clips));error='';status='Audio clips applied.';}catch(e){error=String(e);}}
</script>
<h2>Edit audio clips</h2>
<p>Root timeline clips use existing WAV asset references. Start frames are one-based; offsets are source samples. Gain ranges from -16 to 16. Overlaps mix in list order. Closing discards unapplied changes.</p>
<p>Linear fades are source sample counts after the offset. Zero disables a fade; one silences the endpoint. Overlapping fades multiply. Each fade must fit the remaining source. Changing assets or offsets keeps your draft fade values and may require adjusting them before Apply.</p>
{#if !assets.length}<p>No audio assets are available. Import a WAV asset in a supported local project first.</p>{/if}
<div bind:this={clipList}>
{#each clips as clip,i (clip.id)}
 <fieldset data-audio-clip={clip.id}><legend>Clip {i+1}</legend>
 <label>Clip {i+1} asset <select bind:value={clip.assetId}>{#each assets as asset}<option value={asset.id}>{asset.audio!.name} — {asset.path}</option>{/each}</select></label>
 <label>Clip {i+1} start frame <input type="number" min="1" max={snapshot.duration} value={clip.startFrame+1} oninput={e=>clip.startFrame=e.currentTarget.valueAsNumber-1}/></label>
 <label>Clip {i+1} offset samples <input type="number" min="0" step="1" bind:value={clip.offsetSamples}/></label>
 <label>Clip {i+1} gain <input type="number" min="-16" max="16" step="0.1" bind:value={clip.gain}/></label>
 <label>Clip {i+1} fade in samples <input type="number" min="0" step="1" value={clip.fadeInSamples??0} oninput={e=>clip.fadeInSamples=e.currentTarget.valueAsNumber}/></label>
 <label>Clip {i+1} fade out samples <input type="number" min="0" step="1" value={clip.fadeOutSamples??0} oninput={e=>clip.fadeOutSamples=e.currentTarget.valueAsNumber}/></label>
 <button onclick={()=>remove(clip.id)}>Remove clip {i+1}</button>
 </fieldset>
{/each}
</div>
<div class="actions"><button data-audio-clip-add bind:this={addButton} disabled={!assets.length||clips.length>=10000} onclick={add}>Add audio clip</button><button onclick={commit}>Apply audio clips</button></div>
<p role="status">{status}</p>{#if error}<p role="alert">{error}</p>{/if}
<style>label{display:block;margin:8px 0}input,select{margin-left:8px}fieldset{margin:12px 0}.actions{display:flex;gap:8px}p{max-width:580px}</style>
