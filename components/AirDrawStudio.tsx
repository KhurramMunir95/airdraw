"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Download, Eraser, Hand, Sparkles, Type, Undo2, Redo2, Trash2, MousePointer2, RefreshCw, Check, X, PenLine, Settings2 } from "lucide-react";

import { recognizeInk, type OCRResult, type RecognitionMode, type InkStroke } from "../lib/recognition";
type P = { x: number; y: number };
type Stroke = InkStroke;
type Vision = typeof import("@mediapipe/tasks-vision");
const W = 960, H = 600;
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label + " timed out. Check your network and try again.")), ms);
    promise.then(value => { window.clearTimeout(timer); resolve(value); }, error => { window.clearTimeout(timer); reject(error); });
  });
}
const COLORS = ["#76e7fc", "#a892ff", "#ff8bce", "#fba870", "#f8f8ff", "#8ff8a3"];

export default function AirDrawStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const drawingRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const sessionRef = useRef(0);
  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<P | null>(null);
  const pinchingRef = useRef(false);
  const modeRef = useRef<"hand"|"mouse">("hand");
  const colorRef = useRef(COLORS[0]);
  const widthRef = useRef(5);
  const brushRef = useRef<"neon"|"pen">("neon");
  const [cameraOn, setCameraOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("Starting camera...");
  const [tracking, setTracking] = useState(false);
  const [mode, setMode] = useState<"hand"|"mouse">("hand");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const skeletonRef = useRef(true);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(5);
  const [brush, setBrush] = useState<"neon"|"pen">("neon");
  const [wordMode, setWordMode] = useState(false);
  const [ocrMode,setOcrMode] = useState<RecognitionMode>("word");
  const [ocrResult,setOcrResult] = useState<OCRResult|null>(null);
  const [customVocabulary,setCustomVocabulary] = useState("");
  const [tool,setTool] = useState<"draw"|"erase">("draw");
  const toolRef = useRef<"draw"|"erase">("draw");
  const [eraserSize,setEraserSize] = useState(32);
  const eraserSizeRef=useRef(32);
  const [canRedo,setCanRedo]=useState(false);
  const redoRef=useRef<Stroke[][]>([]);
  const undoRef=useRef<Stroke[][]>([]);
  const eraseSnapshotRef=useRef<Stroke[]|null>(null);
  const [recognized, setRecognized] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [strokesCount, setStrokesCount] = useState(0);

  const rememberChange=()=>{redoRef.current=[];setCanRedo(false);};
  const cloneStrokes=(strokes:Stroke[])=>strokes.map(s=>({...s,points:s.points.map(p=>({...p}))}));
  const eraseAt=(point:P)=>{
    const radius=eraserSizeRef.current;
    if(!eraseSnapshotRef.current){eraseSnapshotRef.current=cloneStrokes(strokesRef.current);undoRef.current.push(eraseSnapshotRef.current);rememberChange();}
    const result:Stroke[]=[];
    for(const stroke of strokesRef.current){
      let part:P[]=[];
      const flush=()=>{if(part.length){result.push({...stroke,points:part});part=[];}};
      for(const p of stroke.points){
        if(Math.hypot(p.x-point.x,p.y-point.y)<=radius){flush();}
        else part.push(p);
      }
      flush();
    }
    strokesRef.current=result;
    setStrokesCount(result.length);
    renderStrokes();
  };
  const renderStrokes = useCallback(() => {
    const c = drawingRef.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    const all = [...strokesRef.current, ...(activeRef.current ? [activeRef.current] : [])];
    for (const s of all) {
      if (!s.points.length) continue;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i=1;i<s.points.length;i++) {
        const previous = s.points[i-1], current = s.points[i];
        ctx.quadraticCurveTo(previous.x, previous.y, (previous.x+current.x)/2, (previous.y+current.y)/2);
      }
      const last = s.points[s.points.length - 1];
      ctx.lineTo(last.x,last.y);
      ctx.strokeStyle = s.color;
      ctx.lineWidth=s.width;
      ctx.lineJoin="round";
      ctx.lineCap="round";
      ctx.shadowColor=s.mode === "neon" ? s.color : "transparent";
      ctx.shadowBlur=s.mode === "neon" ? 17 : 0;
      ctx.stroke();
      ctx.shadowBlur=0;
      if(s.points.length===1){ctx.beginPath();ctx.arc(last.x,last.y,s.width/2,0,Math.PI*2);ctx.fillStyle=s.color;ctx.fill();}
    }
  }, []);

  const finishStroke = useCallback(() => {
    if (activeRef.current?.points.length) { undoRef.current.push(cloneStrokes(strokesRef.current));strokesRef.current.push(activeRef.current);rememberChange(); }
    activeRef.current=null; lastPointRef.current=null; pinchingRef.current=false;
    setStrokesCount(strokesRef.current.length);
    renderStrokes();
  }, [renderStrokes]);

  const addPoint = useCallback((point:P, draw:boolean) => {
    if (!draw) { if (pinchingRef.current) finishStroke();eraseSnapshotRef.current=null; return; }
    if(toolRef.current==="erase"){if(pinchingRef.current)finishStroke();eraseAt(point);return;}
    if (!pinchingRef.current) {
      activeRef.current={ points:[point],color:colorRef.current,width:widthRef.current,mode:brushRef.current };
      pinchingRef.current=true;
    } else if (activeRef.current) {
      const prev=lastPointRef.current;
      if(!prev || Math.hypot(point.x-prev.x,point.y-prev.y)>2.3) activeRef.current.points.push(point);
    }
    lastPointRef.current=point;
    renderStrokes();
  },[finishStroke,renderStrokes]);

  const stopCamera = useCallback(() => {
    sessionRef.current += 1;
    setLoadingStage("Starting camera...");
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    if(videoRef.current) videoRef.current.srcObject=null;
    trackerRef.current?.close?.();
    trackerRef.current=null;
    setCameraOn(false);setTracking(false);setLoading(false);
    overlayRef.current?.getContext("2d")?.clearRect(0,0,W,H);
    finishStroke();
  },[finishStroke]);

  const startCamera = useCallback(async () => {
    if (loading || streamRef.current) return;
    const session = ++sessionRef.current;
    setLoading(true); setError(""); setLoadingStage("Requesting camera permission...");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost and a supported browser.");
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({video:{width:1280,height:720,facingMode:"user"},audio:false}),
        20000,"Camera permission");
      if(session!==sessionRef.current){stream.getTracks().forEach(t=>t.stop());return;}
      streamRef.current=stream;
      const video=videoRef.current;
      if(!video) throw new Error("Camera preview is not available.");
      video.srcObject=stream;
      // Show the actual webcam immediately: ML assets can be 10-30MB and must not hide the video.
      setCameraOn(true); setLoadingStage("Starting live camera preview...");
      await withTimeout(video.play(),12000,"Camera playback");
      if(session!==sessionRef.current)return;

      setLoadingStage("Downloading hand-tracking model (first launch may take longer)...");
      const vision:Vision=await withTimeout(import("@mediapipe/tasks-vision"),20000,"Vision library");
      const assets = "/airdraw/mediapipe";
      const wasmPath = assets + "/wasm";
      const handModel = assets + "/models/hand_landmarker.task";
      // Self-host heavy vision files on GitHub Pages to avoid end-user CDN connection resets.
      const fileset=await withTimeout(
        vision.FilesetResolver.forVisionTasks(wasmPath),
        15000,"Local MediaPipe WASM");
      // CPU delegate is the most compatible baseline across integrated/mobile GPUs.
      const tracker=await withTimeout(vision.HandLandmarker.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:handModel,delegate:"CPU"},
        runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:0.55,minTrackingConfidence:0.5
      }),45000,"Hand tracking model");
      if(session!==sessionRef.current){tracker.close();return;}
      trackerRef.current=tracker;
      setLoading(false); setLoadingStage("");
      // Start hand tracking NOW, rather than waiting for the optional face model.

      const tick=()=>{
        const v=videoRef.current, o=overlayRef.current, tracker=trackerRef.current;
        if(!v || !o || !tracker || !streamRef.current) return;
        const ctx=o.getContext("2d");
        if(!ctx) return;
        ctx.clearRect(0,0,W,H);
        if(v.readyState>=2 && v.currentTime>0){
          try {
            const result=tracker.detectForVideo(v,performance.now());
            const landmarks=result.landmarks?.[0];
            setTracking(Boolean(landmarks));
            if(landmarks){
              const p=(i:number)=>({x:(1-landmarks[i].x)*W,y:landmarks[i].y*H});
              if(skeletonRef.current){
                ctx.strokeStyle="rgba(118,231,252,.76)";ctx.lineWidth=2;
                for(const {start,end} of vision.HandLandmarker.HAND_CONNECTIONS){const q=p(start),r=p(end);ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(r.x,r.y);ctx.stroke();}
                landmarks.forEach((_:any,i:number)=>{const q=p(i);ctx.beginPath();ctx.arc(q.x,q.y,i===8?6:3,0,Math.PI*2);ctx.fillStyle=i===8?"#fff":"#76e7fc";ctx.fill();});
              }
              const tip=p(8), thumb=p(4);
              const distance=Math.hypot(tip.x-thumb.x,tip.y-thumb.y);
              const pinch=pinchingRef.current ? distance<56 : distance<37;
              if(modeRef.current==="hand") addPoint(tip,pinch);
              ctx.beginPath();ctx.arc(tip.x,tip.y,pinch?14:10,0,Math.PI*2);
              ctx.strokeStyle=pinch?"#a2ffa2":"#ffffff";ctx.lineWidth=3;ctx.stroke();
            }else if(modeRef.current==="hand"){addPoint({x:0,y:0},false);}
          }catch(e){console.warn("Tracking frame failed",e);}
        }
        rafRef.current=requestAnimationFrame(tick);
      };
      rafRef.current=requestAnimationFrame(tick);
    }catch(e){
      if(session===sessionRef.current){
        console.error("Camera or hand tracker failed:",e);
        const detail = e instanceof Error ? e.message : String(e);
        setError("Hand tracking initialization failed: " + detail + ". Check /airdraw/mediapipe files or refresh the page.");
        setLoadingStage("");
        setLoading(false);
        // Keep a working camera preview visible after a tracking download failure.
        if(!streamRef.current) setCameraOn(false);
      }
    }finally{if(session===sessionRef.current)setLoading(false);}
  },[addPoint,loading]);

  const recognize = async () => {
    finishStroke();setReading(true);setError("");
    try {
      const result=await recognizeInk(strokesRef.current,ocrMode,customVocabulary.split(/[,\n]/).map(x=>x.trim()));
      setOcrResult(result);setRecognized(result.best.text);
    } catch(e) {setError(e instanceof Error?e.message:"Recognition failed. Please retry.");}
    finally{setReading(false);}
  };
  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);streamRef.current?.getTracks().forEach(t=>t.stop());trackerRef.current?.close?.();},[]);
  const clear=()=>{finishStroke();undoRef.current.push(cloneStrokes(strokesRef.current));rememberChange();strokesRef.current=[];setStrokesCount(0);setRecognized("");setOcrResult(null);renderStrokes();};
  const undo=()=>{finishStroke();const previous=undoRef.current.pop();if(!previous)return;redoRef.current.push(cloneStrokes(strokesRef.current));setCanRedo(true);strokesRef.current=previous;setStrokesCount(previous.length);renderStrokes();};
  const redo=()=>{finishStroke();const next=redoRef.current.pop();if(!next)return;undoRef.current.push(cloneStrokes(strokesRef.current));strokesRef.current=next;setCanRedo(redoRef.current.length>0);setStrokesCount(next.length);renderStrokes();};
  const setActiveTool=(t:"draw"|"erase")=>{finishStroke();eraseSnapshotRef.current=null;toolRef.current=t;setTool(t);};
  const save=()=>{const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d");if(!ctx)return;ctx.drawImage(drawingRef.current!,0,0);const a=document.createElement("a");a.download="airdraw-art.png";a.href=c.toDataURL("image/png");a.click();};
  const mousePoint=(e:React.PointerEvent<HTMLCanvasElement>):P=>{const b=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-b.left)/b.width*W,y:(e.clientY-b.top)/b.height*H};};
  return <main className="app">
    <header className="topbar"><div className="brand"><div className="brandmark"><Sparkles size={21}/></div><div><strong>AirDraw<span> Studio</span></strong><small>CREATE WITHOUT TOUCHING</small></div></div><div className="headcenter"><span className="pulse"/> {cameraOn?"CAMERA LIVE":"CAMERA OFF"} <span className="headsplit">/</span> HAND {tracking?"DETECTED":"WAITING"} </div><div className="topactions"><span className="version">v2.0</span><a href="https://github.com/KhurramMunir95/airdraw" target="_blank" rel="noopener noreferrer" className="github">GitHub ↗</a></div></header>
    <section className="content">
      <aside className="sidebar"><div className="asidehead"><span>WORKSPACE</span><Settings2 size={16}/></div>
        <div className="paneltitle">Input mode</div>
        <div className="modebuttons"><button className={mode==="hand"?"selected":""} onClick={()=>{finishStroke();modeRef.current="hand";setMode("hand");}}><Hand size={17}/> Hand</button><button className={mode==="mouse"?"selected":""} onClick={()=>{finishStroke();modeRef.current="mouse";setMode("mouse");}}><MousePointer2 size={17}/> Mouse</button></div>
        <div className="sepline"/>
        <div className="paneltitle">Canvas tool</div>
        <div className="modebuttons"><button className={tool==="draw"?"selected":""} onClick={()=>setActiveTool("draw")}><PenLine size={17}/> Draw</button><button className={tool==="erase"?"selected":""} onClick={()=>setActiveTool("erase")}><Eraser size={17}/> Erase</button></div>
        {tool==="erase" && <><label className="rangehead">Eraser radius <strong>{eraserSize}px</strong></label><input className="slider" type="range" min="10" max="70" value={eraserSize} onChange={e=>{setEraserSize(+e.target.value);eraserSizeRef.current=+e.target.value;}} /></>}
        <div className="sepline"/>
        <div className="paneltitle">Brush style</div><div className="brushes"><button className={brush==="neon"?"brush selected":"brush"} onClick={()=>{brushRef.current="neon";setBrush("neon");}}><Sparkles size={17}/> Neon glow <Check size={14}/></button><button className={brush==="pen"?"brush selected":"brush"} onClick={()=>{brushRef.current="pen";setBrush("pen");}}><PenLine size={17}/> Solid ink <Check size={14}/></button></div>
        <div className="sepline"/>
        <div className="paneltitle">Stroke color</div><div className="swatches">{COLORS.map(c=><button key={c} aria-label={c} onClick={()=>{setColor(c);colorRef.current=c;}} className={c===color?"swatch current":"swatch"} style={{background:c}} />)}</div>
        <label className="rangehead">Brush size <strong>{width}px</strong></label><input className="slider" type="range" min="2" max="26" value={width} onChange={e=>{const n=+e.target.value;setWidth(n);widthRef.current=n;}} />
        <div className="sepline"/>
        <div className="paneltitle">Tracking overlays</div>
        <label className="toggle"><span><Hand size={16}/> Hand skeleton</span><input type="checkbox" checked={showSkeleton} onChange={e=>{setShowSkeleton(e.target.checked);skeletonRef.current=e.target.checked;}} /></label>

      </aside>
      <div className="workspace">
        <div className="workspacehead"><div><span className="breadcrumb">STUDIO / LIVE CANVAS</span><h1>Draw something amazing<span>.</span></h1><p>Move your index finger. Pinch thumb and finger to draw.</p></div><div className="quickactions"><button title="Undo last stroke" onClick={undo}><Undo2 size={17}/></button><button title="Redo" onClick={redo} disabled={!canRedo}><Redo2 size={17}/></button><button title="Clear canvas" onClick={clear}><Trash2 size={17}/></button><button className="save" onClick={save}><Download size={16}/> Export PNG</button></div></div>
        <div className="canvasframe"><div className="canvastop"><span><span className="dot"/> LIVE CANVAS</span><span>960 × 600 <span className="dim">/</span> {mode.toUpperCase()} MODE</span></div>
          <div className="stage"><video ref={videoRef} muted autoPlay playsInline className={cameraOn?"video visible":"video"} /><div className="gridoverlay"/><canvas ref={drawingRef} width={W} height={H} className="drawing"/><canvas ref={overlayRef} width={W} height={H} className="overlay"/><canvas width={W} height={H} className="mousecanvas" style={{pointerEvents:mode==="mouse"?"auto":"none",touchAction:"none",cursor:mode==="mouse"?"crosshair":"default"}} onPointerDown={e=>{if(mode!=="mouse")return;e.currentTarget.setPointerCapture(e.pointerId);addPoint(mousePoint(e),true);}} onPointerMove={e=>{if(mode==="mouse" && e.buttons===1)addPoint(mousePoint(e),true);}} onPointerUp={()=>{finishStroke();eraseSnapshotRef.current=null;}} onPointerCancel={()=>{finishStroke();eraseSnapshotRef.current=null;}}/>
            {!cameraOn && mode==="hand" && <div className="stageempty"><div className="emptyicon"><Hand size={42}/></div><h2>Your canvas is ready</h2><p>Turn on your camera to draw in the air, or switch to mouse mode to try it now.</p><button onClick={startCamera} disabled={loading} className="primary"><Camera size={17}/>{loading ? loadingStage : "Enable camera"}</button></div>}
            {cameraOn && <div className="trackingpill"><span className={tracking?"green":"yellow"}/> {loading ? loadingStage : tracking ? "Hand detected — pinch to draw" : trackerRef.current ? "Show your hand to the camera" : "Hand tracker unavailable — restart camera"}</div>}
          </div><div className="canvasbottom"><div><span className="statusdot"/> {strokesCount} strokes <span className="midpoint">·</span> {tool==="erase"?"Eraser active":"Draw tool active"}</div><div>PRIVATE & LOCAL <span className="midpoint">·</span> NO VIDEO UPLOADS</div></div></div>
        {error && <div className="error"><span>{error}</span><button onClick={()=>setError("")}><X size={14}/></button></div>}
        <div className="instructions"><div><span className="instructionicon"><Hand size={20}/></span><div><b>01. Show your hand</b><small>Keep it visible in the frame</small></div></div><div><span className="instructionicon"><MousePointer2 size={20}/></span><div><b>02. Pinch to draw</b><small>Touch thumb and index finger</small></div></div><div><span className="instructionicon"><Sparkles size={20}/></span><div><b>03. Create & save</b><small>Release, recognize, or export</small></div></div></div>
      </div>
      <aside className="sidebar rightbar"><div className="asidehead"><span>SMART TOOLS</span><Sparkles size={16}/></div>
        <div className="smartcard"><div className="smarticon"><Type size={20}/></div><b>Advanced Air-to-Text</b><p>Write large, separate letters. We crop and enhance strokes, then compare multiple OCR passes.</p>
        <label className="toggle switchrow"><span>Recognition mode</span><input type="checkbox" checked={wordMode} onChange={e=>setWordMode(e.target.checked)}/></label>
        {wordMode && <>
          <div className="modebuttons"><button className={ocrMode==="word"?"selected":""} onClick={()=>setOcrMode("word")}>Word</button><button className={ocrMode==="letter"?"selected":""} onClick={()=>setOcrMode("letter")}>Letter</button></div>
          <label className="rangehead">Optional vocabulary</label>
          <input className="vocabinput" value={customVocabulary} onChange={e=>setCustomVocabulary(e.target.value)} placeholder="jungle, pineapple, names..." />
          <button className="recognize" disabled={reading} onClick={recognize}>{reading?<RefreshCw size={16} className="spin"/>:<Type size={16}/>} {reading?"Reading handwriting...":"Recognize handwriting"}</button>
          <div className="result"><small>EDITABLE RECOGNIZED TEXT</small><textarea aria-label="Edit recognized text" rows={2} value={recognized} placeholder="Recognition result appears here" onChange={e=>setRecognized(e.target.value)}/>
            {ocrResult && <><small>OCR CONFIDENCE: {ocrResult.best.confidence}% (estimate)</small>
            {ocrResult.alternatives.length>0 && <div className="suggestions"><small>OTHER READINGS</small>{ocrResult.alternatives.map(v=><button key={v.text} onClick={()=>setRecognized(v.text)}>{v.text}</button>)}</div>}
            {ocrResult.suggestions.length>0 && <div className="suggestions"><small>POSSIBLE CORRECTIONS</small>{ocrResult.suggestions.map(v=><button key={v} onClick={()=>setRecognized(v)}>{v}</button>)}</div>}</>}
            <button disabled={!recognized} onClick={()=>void navigator.clipboard.writeText(recognized)}>Copy corrected text</button></div>
          <small className="hint">Experimental handwriting OCR, not a handwriting-trained neural model. Joined-up writing and similar letters can still be incorrect. Results are editable, and suggestions are never applied silently.</small>
        </>}
        </div><div className="sepline"/><div className="paneltitle">CAMERA CONTROL</div>{cameraOn?<button onClick={stopCamera} className="camerabutton off"><CameraOff size={17}/> Turn camera off</button>:<button onClick={startCamera} disabled={loading} className="camerabutton"><Camera size={17}/>{loading ? loadingStage : "Turn camera on"}</button>}
        <div className="systemstatus"><span>Hand tracker <b className={tracking?"online":"offline"}>{tracking?"ACTIVE":"STANDBY"}</b></span><span>Processing <b>ON DEVICE</b></span></div>
      </aside>
    </section><footer className="footer"><span>AirDraw Studio © 2026</span><span>Built for creativity, powered by computer vision.</span></footer>
  </main>;
}
