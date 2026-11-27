import {exportPresentationHTML,exportScriptReplayHTML,exportScriptReplayFramesHTML} from '../../../packages/export-web/src';

// Trusted artwork compiler only: document script bodies remain inert serialized data.
self.onmessage=event=>{
  self.onmessage=null;
  try{
    const {project,poses,textValues,playback,replayCapture,replayText,replayWave}=event.data;
    const html=replayCapture===true?exportScriptReplayFramesHTML(project,poses,replayText):
      playback===true?exportScriptReplayHTML(project,poses,replayText,replayWave):exportPresentationHTML(project,poses,textValues);
    if(html.length>64*1024*1024||new TextEncoder().encode(html).byteLength>64*1024*1024)
      throw new Error('Script artwork HTML exceeds 64 MiB.');
    self.postMessage({ok:true,html});
  }catch(error){self.postMessage({ok:false,error:String(error).slice(0,2000)});}
};
