import { createWorker, PSM, type Worker } from "tesseract.js";

export type Point = { x: number; y: number };
export type InkStroke = { points: Point[]; color: string; width: number; mode: "neon" | "pen" | "marker" };
export type RecognitionMode = "word" | "letter";
export type OCRCandidate = { text: string; confidence: number };
export type OCRResult = { best: OCRCandidate; alternatives: OCRCandidate[]; suggestions: string[] };

let workerPromise: Promise<Worker> | null = null;
const COMMON_WORDS = `about above across action after again air airplane always amazing animal answer apple april around awesome back beautiful because become before begin below best better black blue book bottle boy bring brother brush build camera canvas car cat change child city clean clear close cloud color come computer cooking copy correct creative custom dance dark day demo design detect different dog door draw drawing dream drink easy eat effect eight english erase eraser even every example experience face family fast father feature feel find finger finish fire first five flower food forest four free friend from fruit fun game garden get girl give glass glow good green grow hand happy hard have head heart help hello here home horse house how human idea image improve inside interesting into island jump jungle just keep keyboard kind kitchen know language large last later learn leave letter light line lion little live load local look love magic make man mango many map master match media menu mind mirror model modern monkey more morning mouse move movement music name natural near neon new next nice night nine note number open option orange other out output over paint paper parent party path pen pencil people perfect phone photo picture pink place plant play please point polish powerful practice preview problem project purple quick rain rainbow read really record red redo remove reset result right river road robot room run safety save school screen search select sentence shape shirt show simple skill sky small smile smooth snake snow software solid song soon space special speed spell spelling star start step stop story street strong studio summer sun support sweet table take talk teacher team test text thanks that the their them there these thing think this three tiger time today tool touch tracking train tree try two type understand undo unique upload use user value video view visual walk want warm water way webcam welcome well white wild window winter with word work world write writing yellow yes you zebra zero`.split(" ");

function distance(a: string, b: string): number {
  const d = Array.from({length:b.length+1}, (_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=d[0];d[0]=i;
    for(let j=1;j<=b.length;j++){
      const old=d[j];
      d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=old;
    }
  }
  return d[b.length];
}
function normalize(t:string):string { return t.replace(/[^a-zA-Z\s'-]/g,"").replace(/\s+/g," ").trim(); }

export function getSuggestions(raw:string, vocabulary:string[]=[]):string[]{
  const word=normalize(raw).toLowerCase();
  if(!word || word.includes(" ") || word.length<3) return [];
  const dictionary=Array.from(new Set([...COMMON_WORDS, ...vocabulary.map(x=>x.toLowerCase().trim()).filter(Boolean)]));
  if(dictionary.includes(word)) return [];
  const limit=word.length<=4?1:2;
  return dictionary.map(w=>({word:w,score:distance(word,w)}))
    .filter(x=>x.score<=limit && Math.abs(x.word.length-word.length)<=2)
    .sort((a,b)=>a.score-b.score || Math.abs(a.word.length-word.length)-Math.abs(b.word.length-word.length))
    .slice(0,5).map(x=>x.word);
}

/**
 * Render only actual handwriting, not the full webcam/canvas, into an
 * OCR-friendly, high-resolution monochrome bitmap with generous margins.
 */
export function makeOCRCanvas(strokes:InkStroke[], variant:"normal"|"heavy"="normal"):HTMLCanvasElement {
  const points=strokes.flatMap(s=>s.points);
  if(!points.length)throw new Error("Write something on the canvas before recognizing.");
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  const spanX=Math.max(28,maxX-minX),spanY=Math.max(28,maxY-minY);
  const scale=Math.min(4,Math.max(1.4,560/spanX,130/spanY));
  const pad=55;
  const c=document.createElement("canvas");
  c.width=Math.max(140,Math.ceil(spanX*scale+pad*2));
  c.height=Math.max(120,Math.ceil(spanY*scale+pad*2));
  const ctx=c.getContext("2d");
  if(!ctx)throw new Error("Canvas 2D unavailable.");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
  ctx.lineJoin="round";ctx.lineCap="round";ctx.strokeStyle="#111";
  for(const s of strokes){
    if(!s.points.length)continue;
    ctx.beginPath();
    const toX=(p:Point)=>pad+(p.x-minX)*scale;
    const toY=(p:Point)=>pad+(p.y-minY)*scale;
    ctx.moveTo(toX(s.points[0]),toY(s.points[0]));
    for(let i=1;i<s.points.length;i++)ctx.lineTo(toX(s.points[i]),toY(s.points[i]));
    ctx.lineWidth=Math.max(4,(variant==="heavy"?8:5)*scale);
    if(s.points.length===1){ctx.lineTo(toX(s.points[0])+.3,toY(s.points[0])+.3);}
    ctx.stroke();
  }
  return c;
}

async function getWorker():Promise<Worker>{
  if(!workerPromise){
    const base="/airdraw/ocr";
    workerPromise=createWorker("eng",1,{
      workerPath:base+"/worker.min.js",
      corePath:base+"/core",
      langPath:base+"/lang",
      workerBlobURL:false,
      gzip:true
    }).catch(err=>{workerPromise=null;throw err;});
  }
  return workerPromise;
}

export async function disposeRecognitionWorker():Promise<void>{
  const pending=workerPromise;
  workerPromise=null;
  if(pending){try{const w=await pending;await w.terminate();}catch{ /* startup may have failed */ }}
}
export async function recognizeInk(strokes:InkStroke[], mode:RecognitionMode, vocabulary:string[]=[]):Promise<OCRResult>{
  const valid=strokes.filter(s=>s.points.length);
  if(!valid.length)throw new Error("Draw a word or letter first.");
  const worker=await getWorker();
  const passes: Array<{psm:PSM, variant:"normal"|"heavy"}> = mode==="letter"
    ? [{psm:PSM.SINGLE_CHAR,variant:"normal"},{psm:PSM.SINGLE_CHAR,variant:"heavy"}]
    : [{psm:PSM.SINGLE_WORD,variant:"normal"},{psm:PSM.RAW_LINE,variant:"heavy"},{psm:PSM.SINGLE_LINE,variant:"normal"}];
  const candidates:OCRCandidate[]=[];
  for(const pass of passes){
    await worker.setParameters({
      tessedit_pageseg_mode:pass.psm,
      tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"+(mode==="word"?" '-":""),
      preserve_interword_spaces:"1",
      user_defined_dpi:"300"
    });
    const result=await worker.recognize(makeOCRCanvas(valid,pass.variant));
    const text=normalize(result.data.text);
    if(text)candidates.push({text:mode==="letter"?text.slice(0,1):text,confidence:Math.max(0,Math.round(result.data.confidence))});
  }
  if(!candidates.length)throw new Error("No readable text detected. Write bigger, separate the letters, and try again.");
  // Prefer clean words, with OCR confidence as the primary signal.
  const sorted=candidates.sort((a,b)=>{
    const score=(x:OCRCandidate)=>(x.confidence)+(mode==="word"&&/^[a-z]+$/i.test(x.text)?3:0);
    return score(b)-score(a);
  });
  const unique=sorted.filter((c,i,all)=>all.findIndex(x=>x.text.toLowerCase()===c.text.toLowerCase())===i);
  const best=unique[0];
  const dictionarySuggestions=getSuggestions(best.text,vocabulary);
  // Only display suggestions: never silently replace recognition with a guessed word.
  return {best,alternatives:unique.slice(1,4),suggestions:dictionarySuggestions};
}
