/**
 * Gesture shortcuts use only MediaPipe's 21 hand landmarks.
 * They are heuristic and intentionally conservative to limit accidental tools.
 * Coordinates are normalized by MediaPipe; no face/body tracking is involved.
 */
export type HandPoint = { x: number; y: number; z?: number };
export type HandSign = "victory" | "three" | "open" | "thumbs_up" | "fist" | null;
export type ToolGesture = Exclude<HandSign, null>;
export const GESTURE_LABELS: Record<ToolGesture,string> = {
  victory: "✌ Eraser",
  three: "3 fingers · Ink pen",
  open: "🖐 Neon brush",
  thumbs_up: "👍 Marker",
  fist: "✊ Undo"
};
const length=(a:HandPoint,b:HandPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const angle=(a:HandPoint,b:HandPoint,c:HandPoint):number=>{
  const u={x:a.x-b.x,y:a.y-b.y},v={x:c.x-b.x,y:c.y-b.y};
  const denom=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);
  if(denom<1e-7)return 0;
  return Math.acos(Math.min(1,Math.max(-1,(u.x*v.x+u.y*v.y)/denom)))*180/Math.PI;
};
export function detectHandSign(points:HandPoint[]):HandSign{
  if(points.length<21)return null;
  // Finger straightness: joints give a more orientation-tolerant signal than y positions.
  const extended=([ [5,6,7,8], [9,10,11,12], [13,14,15,16], [17,18,19,20] ] as const)
    .map(([mcp,pip,dip,tip]) => angle(points[mcp],points[pip],points[dip])>151 &&
      angle(points[pip],points[dip],points[tip])>141 &&
      length(points[tip],points[mcp])>length(points[pip],points[mcp])*1.33);
  const [index,middle,ring,pinky]=extended;
  const thumbStraight=angle(points[2],points[3],points[4])>143;
  const thumbUp=thumbStraight && points[4].y<points[2].y-Math.max(.015,length(points[0],points[9])*.16);
  if(index && middle && !ring && !pinky)return "victory";
  if(index && middle && ring && !pinky)return "three";
  if(index && middle && ring && pinky)return "open";
  if(!index && !middle && !ring && !pinky && thumbUp)return "thumbs_up";
  if(!index && !middle && !ring && !pinky && !thumbStraight)return "fist";
  return null;
}
export type GestureEvent = { candidate:HandSign; progress:number; triggered:HandSign };
export class GestureHold {
  private candidate:HandSign=null;
  private since=0;
  private armed=true;
  private lastTrigger=0;
  public reset(){this.candidate=null;this.since=0;this.armed=true;}
  public update(sign:HandSign,now:number,holdMs=850,cooldownMs=1200):GestureEvent{
    if(sign!==this.candidate){
      this.candidate=sign;
      this.since=now;
      // Require a release or different hand sign before repeating the same shortcut.
      this.armed=true;
    }
    if(!sign)return {candidate:null,progress:0,triggered:null};
    const elapsed=Math.max(0,now-this.since);
    const progress=Math.min(1,elapsed/holdMs);
    if(this.armed && elapsed>=holdMs && now-this.lastTrigger>=cooldownMs){
      this.armed=false;
      this.lastTrigger=now;
      return {candidate:sign,progress:1,triggered:sign};
    }
    return {candidate:sign,progress,triggered:null};
  }
}
export function smoothCursor(previous:{x:number;y:number}|null,current:{x:number;y:number},strength:number){
  if(!previous)return current;
  const speed=Math.hypot(current.x-previous.x,current.y-previous.y);
  // Fast movements stay responsive while small jitter is filtered.
  const base=0.12+(1-Math.min(100,Math.max(0,strength))/100)*0.72;
  const alpha=Math.min(1,base+Math.min(.33,speed/110));
  const next={x:previous.x+(current.x-previous.x)*alpha,y:previous.y+(current.y-previous.y)*alpha};
  return Math.hypot(next.x-previous.x,next.y-previous.y)<.12?previous:next;
}
