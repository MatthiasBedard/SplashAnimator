import type { Point } from '../../../packages/document/src';
import { hit } from '../../../packages/geometry/src';
import type { captureRememberedAuthoringFrame } from '../../../packages/animation/src/motion-owner';

type Capture = ReturnType<typeof captureRememberedAuthoringFrame>;

/** The preview image has zero padding/border and centered object-fit:contain. */
export function previewDocumentPoint(client:Point, box:{left:number;top:number;width:number;height:number}, width:number,height:number):Point|null {
  if(![client.x,client.y,box.left,box.top,box.width,box.height,width,height].every(Number.isFinite) ||
    Math.min(box.width,box.height,width,height)<=0)return null;
  const scale=Math.min(box.width/width,box.height/height);
  const x=(client.x-box.left-(box.width-width*scale)/2)/scale;
  const y=(client.y-box.top-(box.height-height*scale)/2)/scale;
  return x>=0&&y>=0&&x<width&&y<height?{x,y}:null;
}

/** Match the root paint stack. The first geometry hit owns the point even if
 * it cannot be promoted. Text and symbols use their authored interaction bounds.
 */
export function pickPreviewRoot(capture:Capture,point:Point) {
  for(let i=capture.scene.length-1;i>=0;i--){
    const {layerId,key}=capture.scene[i];
    for(let j=key.shapes.length-1;j>=0;j--){
      const shape=key.shapes[j];
      if(shape.opacity===0||!hit(shape,point,0))continue;
      if(!capture.choices.some(c=>c.layerId===layerId&&c.shapeId===shape.id))return {kind:'blocked'} as const;
      return {kind:'pick',owner:capture.resolve(layerId,shape.id)} as const;
    }
  }
  return {kind:'empty'} as const;
}
