import { encodeReplayWave, replayWaveByteLimit } from './replay-wave';

export interface HTMLSoundtrack {
  format: 'wav' | 'opus';
  bytes: Uint8Array;
}

export function htmlSoundtrackSource(soundtrack: HTMLSoundtrack, frames: number, fps: number) {
  const { format, bytes } = soundtrack;
  if (format === 'wav') return 'data:audio/wav;base64,' + encodeReplayWave(bytes, frames - 1, fps);
  if (format !== 'opus' || !(bytes instanceof Uint8Array) || bytes.length < 47 ||
      bytes.length > replayWaveByteLimit || String.fromCharCode(...bytes.subarray(0, 4)) !== 'OggS') {
    throw Error('Invalid HTML Ogg Opus soundtrack.');
  }
  let base64 = '';
  for (let start = 0; start < bytes.length; start += 24576)
    base64 += btoa(String.fromCharCode(...bytes.subarray(start, start + 24576)));
  return 'data:audio/ogg;base64,' + base64;
}

/** Only used by normal animation HTML with an embedded soundtrack. */
export const soundtrackPlayback = `const soundtrack=document.querySelector('audio'),transport=document.querySelector('button');
let failed=false,raf=0,cycle=0,previous=0;
const fail=()=>{
  failed=true;
  soundtrack.pause();
  cancelAnimationFrame(raf);
  transport.disabled=true;
  transport.textContent='Audio unavailable';
  c.dataset.audio='error';
};
const audioReady=new Promise((resolve,reject)=>{
  if(soundtrack.error)reject(soundtrack.error);
  else if(soundtrack.readyState>=1)resolve();
  else {
    soundtrack.addEventListener('loadedmetadata',resolve,{once:true});
    soundtrack.addEventListener('error',reject,{once:true});
  }
});
function paintSound(){
  if(failed)return;
  try{
    const seconds=soundtrack.currentTime;
    if(seconds<previous)cycle++;
    previous=seconds;
    const frame=Math.min(p.duration-1,Math.floor(seconds*p.fps));
    draw(0,cycle*p.duration+frame);
    c.dataset.frame=String(frame);
    raf=requestAnimationFrame(paintSound);
  }catch{fail();}
}
soundtrack.addEventListener('error',fail);
soundtrack.addEventListener('play',()=>{transport.textContent='Pause animation';c.dataset.audio='playing';});
soundtrack.addEventListener('pause',()=>{if(!failed){transport.textContent='Play animation';c.dataset.audio='paused';}});
transport.onclick=async()=>{
  if(!soundtrack.paused){soundtrack.pause();return;}
  transport.disabled=true;
  try{await soundtrack.play();}catch{fail();}
  if(!failed)transport.disabled=false;
};
Promise.all([ready,document.fonts.ready,audioReady]).then(()=>{
  c.dataset.audio='paused';
  paintSound();
  if(!failed)transport.disabled=false;
}).catch(fail);`;
