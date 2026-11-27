/** Author-owned PCM16 RIFF fixture; supports unknown odd chunks and data-first ordering. */
export function pcm16WavFixture(samples:number[][],rate=8000,oddChunk=false,dataFirst=false){
  const channelCount=samples.length,frames=samples[0].length,dataBytes=frames*channelCount*2;
  const bytes=new Uint8Array(44+dataBytes+(oddChunk?10:0)),view=new DataView(bytes.buffer);
  const text=(at:number,value:string)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVE');let at=12;
  if(oddChunk){text(at,'JUNK');view.setUint32(at+4,1,true);bytes[at+8]=123;at+=10;}
  const fmt=()=>{text(at,'fmt ');view.setUint32(at+4,16,true);view.setUint16(at+8,1,true);view.setUint16(at+10,channelCount,true);view.setUint32(at+12,rate,true);view.setUint32(at+16,rate*channelCount*2,true);view.setUint16(at+20,channelCount*2,true);view.setUint16(at+22,16,true);at+=24;};
  const data=()=>{text(at,'data');view.setUint32(at+4,dataBytes,true);for(let i=0;i<frames;i++)for(let c=0;c<channelCount;c++)view.setInt16(at+8+(i*channelCount+c)*2,samples[c][i],true);at+=8+dataBytes;};
  if(dataFirst){data();fmt();}else{fmt();data();}return bytes;
}
