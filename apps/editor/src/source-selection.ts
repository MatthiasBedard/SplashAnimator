/** One-based compiler coordinates to original UTF-16 offsets.
 * Reject invalid locations rather than clamping them to unrelated source.
 */
export function sourceSelection(source:string,location:{line:number;column:number}){
  const {line,column}=location;
  if(!Number.isSafeInteger(line)||!Number.isSafeInteger(column)||line<1||column<1)return;
  let row=1,lineStart=0,lineEnd=source.length;
  for(const separator of source.matchAll(/\r\n|[\r\n\u2028\u2029]/g)){
    if(row===line){lineEnd=separator.index;break;}
    row++;
    lineStart=separator.index+separator[0].length;
  }
  const start=lineStart+column-1;
  if(row!==line||start>lineEnd)return;
  const length=start<lineEnd?(source.codePointAt(start)!>0xffff?2:1):0;
  return {start,end:start+length};
}
