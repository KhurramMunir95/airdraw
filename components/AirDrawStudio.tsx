"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Download, Eraser, Hand, ScanFace, Sparkles, Type, Undo2, Trash2, MousePointer2, RefreshCw, Check, X, PenLine, Settings2 } from "lucide-react";

type P = { x: number; y: number };
type Stroke = { points: P[]; color: string; width: number; mode: "neon" | "pen" };
type Vision = typeof import("@mediapipe/tasks-vision");
const W = 960, H = 600;
const COLORS = ["#76e7fc", "#a892ff", "#ff8bce", "#fba870", "#f8f8ff", "#8ff8a3"];

export default function AirDrawStudio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const drawingRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<any>(null);
  const faceRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const strokesRef = useRef<Stroke[]>([]);
  const activeRef = useRef<Stroke | null>(null);
  const lastPointRef = useRef<P | null>(null);
  const pinchingRef = useRef(false);
  const modeRef = useRef<"hand"|"mouse">("hand");
  const faceEnabledRef = useRef(true);
  const colorRef = useRef(COLORS[0]);
  const widthRef = useRef(5);
  const brushRef = useRef<"neon"|"pen">("neon");
  const [cameraOn, setCameraOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [faceFound, setFaceFound] = useState(false);
  const [mode, setMode] = useState<"hand"|"mouse">("hand");
  const [showSkeleton, setShowSkeleton] = useState(true);
  const skeletonRef = useRef(true);
  const [faceEnabled, setFaceEnabled] = useState(true);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(5);
  const [brush, setBrush] = useState<"neon"|"pen">("neon");
  const [wordMode, setWordMode] = useState(false);
  const [recognized, setRecognized] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [strokesCount, setStrokesCount] = useState(0);
  const [faceGesture, setFaceGesture] = useState(false);
  const gestureRef = useRef(false);
  const faceTriggerRef = useRef(0);
  const recognizeRef = useRef<() => void>(()=>{});

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
    if (activeRef.current?.points.length) strokesRef.current.push(activeRef.current);
    activeRef.current=null; lastPointRef.current=null; pinchingRef.current=false;
    setStrokesCount(strokesRef.current.length);
    renderStrokes();
  }, [renderStrokes]);

  const addPoint = useCallback((point:P, draw:boolean) => {
    if (!draw) { if (pinchingRef.current) finishStroke(); return; }
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
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    if(videoRef.current) videoRef.current.srcObject=null;
    trackerRef.current?.close?.(); faceRef.current?.close?.();
    trackerRef.current=null; faceRef.current=null;
    setCameraOn(false);setTracking(false);setFaceFound(false);setLoading(false);
    overlayRef.current?.getContext("2d")?.clearRect(0,0,W,H);
    finishStroke();
  },[finishStroke]);

  const startCamera = useCallback(async () => {
    setLoading(true);setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera requires HTTPS or localhost and a supported browser.");
      const stream = await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720,facingMode:"user"},audio:false});
      streamRef.current=stream;
      if(!videoRef.current) throw new Error("Camera preview is not available.");
      videoRef.current.srcObject=stream;
      await videoRef.current.play();
      const vision:Vision=await import("@mediapipe/tasks-vision");
      const fileset=await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm");
      trackerRef.current=await vision.HandLandmarker.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",delegate:"GPU"},
        runningMode:"VIDEO",numHands:1,minHandDetectionConfidence:0.55,minTrackingConfidence:0.5
      }).catch(async()=>vision.HandLandmarker.createFromOptions(fileset,{
        baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",delegate:"CPU"},
        runningMode:"VIDEO",numHands:1
      }));
      try {
        faceRef.current=await vision.FaceLandmarker.createFromOptions(fileset,{
          baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",delegate:"CPU"},
          runningMode:"VIDEO",numFaces:1,outputFaceBlendshapes:true
        });
      } catch(e){console.warn("Face detector unavailable:",e);setError("Hand drawing works, but the face model could not load.");}
      setCameraOn(true);setLoading(false);
      let frame=0;
      const tick=()=>{
        const v=videoRef.current, o=overlayRef.current, tracker=trackerRef.current, face=faceRef.current;
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
            if(face && frame++%2===0){
              const f=face.detectForVideo(v,performance.now());
              const points=f.faceLandmarks?.[0];setFaceFound(Boolean(points));
              if(points && faceEnabledRef.current){
                ctx.strokeStyle="rgba(251,170,115,.55)";ctx.lineWidth=1;
                const contours=[vision.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,vision.FaceLandmarker.FACE_LANDMARKS_LIPS,vision.FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,vision.FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE];
                for(const links of contours)for(const {start,end} of links){
                  const a=points[start],b=points[end];ctx.beginPath();ctx.moveTo((1-a.x)*W,a.y*H);ctx.lineTo((1-b.x)*W,b.y*H);ctx.stroke();
                }
              }
              const jaw=f.faceBlendshapes?.[0]?.categories?.find((c:any)=>c.categoryName==="jawOpen")?.score ?? 0;
              if(gestureRef.current && jaw>0.65 && Date.now()-faceTriggerRef.current>4000){
                faceTriggerRef.current=Date.now();recognizeRef.current();
              }
            }
          }catch(e){console.warn("Tracking frame failed",e);}
        }
        rafRef.current=requestAnimationFrame(tick);
      };
      rafRef.current=requestAnimationFrame(tick);
    }catch(e){stopCamera();setError(e instanceof Error?e.message:"Unable to start camera.");}
    finally{setLoading(false);}
  },[addPoint,stopCamera]);

  const recognize = useCallback(async () => {
    if(!strokesRef.current.length && !activeRef.current){setError("Draw a word first, then choose Recognize.");return;}
    finishStroke();setReading(true);setError("");
    try {
      const temp=document.createElement("canvas"); temp.width=W;temp.height=H;
      const c=temp.getContext("2d");if(!c)throw new Error("Canvas unavailable.");
      c.fillStyle="white";c.fillRect(0,0,W,H);c.strokeStyle="#111";c.lineWidth=15;c.lineCap="round";c.lineJoin="round";
      for(const s of strokesRef.current){if(!s.points.length)continue;c.beginPath();c.moveTo(s.points[0].x,s.points[0].y);for(const p of s.points)c.lineTo(p.x,p.y);c.stroke();}
      const { recognize:runOCR }=await import("tesseract.js");
      const result=await runOCR(temp,"eng");
      const text=result.data.text.trim().replace(/\s+/g," ");
      setRecognized(text);if(!text)setError("No clear word found. Try writing larger, separated letters.");
    }catch(e){setError(e instanceof Error?e.message:"Recognition failed. Check your internet connection.");}
    finally{setReading(false);}
  },[finishStroke]);
  recognizeRef.current=recognize;
  useEffect(()=>()=>{cancelAnimationFrame(rafRef.current);streamRef.current?.getTracks().forEach(t=>t.stop());trackerRef.current?.close?.();faceRef.current?.close?.();},[]);
  const clear=()=>{finishStroke();strokesRef.current=[];setStrokesCount(0);setRecognized("");renderStrokes();};
  const undo=()=>{finishStroke();strokesRef.current.pop();setStrokesCount(strokesRef.current.length);renderStrokes();};
  const save=()=>{const c=document.createElement("canvas");c.width=W;c.height=H;const ctx=c.getContext("2d");if(!ctx)return;ctx.drawImage(drawingRef.current!,0,0);const a=document.createElement("a");a.download="airdraw-art.png";a.href=c.toDataURL("image/png");a.click();};
  const mousePoint=(e:React.PointerEvent<HTMLCanvasElement>):P=>{const b=e.currentTarget.getBoundingClientRect();return{x:(e.clientX-b.left)/b.width*W,y:(e.clientY-b.top)/b.height*H};};
  return <main className="app">
    <header className="topbar"><div className="brand"><div className="brandmark"><Sparkles size={21}/></div><div><strong>AirDraw<span> Studio</span></strong><small>CREATE WITHOUT TOUCHING</small></div></div><div className="headcenter"><span className="pulse"/> {cameraOn?"CAMERA LIVE":"CAMERA OFF"} <span className="headsplit">/</span> HAND {tracking?"DETECTED":"WAITING"} </div><div className="topactions"><span className="version">v1.0</span><a href="https://github.com/KhurramMunir95/airdraw" target="_blank" rel="noopener noreferrer" className="github">GitHub ↗</a></div></header>
    <section className="content">
      <aside className="sidebar"><div className="asidehead"><span>WORKSPACE</span><Settings2 size={16}/></div>
        <div className="paneltitle">Input mode</div>
        <div className="modebuttons"><button className={mode==="hand"?"selected":""} onClick={()=>{finishStroke();modeRef.current="hand";setMode("hand");}}><Hand size={17}/> Hand</button><button className={mode==="mouse"?"selected":""} onClick={()=>{finishStroke();modeRef.current="mouse";setMode("mouse");}}><MousePointer2 size={17}/> Mouse</button></div>
        <div className="sepline"/>
        <div className="paneltitle">Brush style</div><div className="brushes"><button className={brush==="neon"?"brush selected":"brush"} onClick={()=>{brushRef.current="neon";setBrush("neon");}}><Sparkles size={17}/> Neon glow <Check size={14}/></button><button className={brush==="pen"?"brush selected":"brush"} onClick={()=>{brushRef.current="pen";setBrush("pen");}}><PenLine size={17}/> Solid ink <Check size={14}/></button></div>
        <div className="sepline"/>
        <div className="paneltitle">Stroke color</div><div className="swatches">{COLORS.map(c=><button key={c} aria-label={c} onClick={()=>{setColor(c);colorRef.current=c;}} className={c===color?"swatch current":"swatch"} style={{background:c}} />)}</div>
        <label className="rangehead">Brush size <strong>{width}px</strong></label><input className="slider" type="range" min="2" max="26" value={width} onChange={e=>{const n=+e.target.value;setWidth(n);widthRef.current=n;}} />
        <div className="sepline"/>
        <div className="paneltitle">Tracking overlays</div>
        <label className="toggle"><span><Hand size={16}/> Hand skeleton</span><input type="checkbox" checked={showSkeleton} onChange={e=>{setShowSkeleton(e.target.checked);skeletonRef.current=e.target.checked;}} /></label>
        <label className="toggle"><span><ScanFace size={16}/> Face contours</span><input type="checkbox" checked={faceEnabled} onChange={e=>{setFaceEnabled(e.target.checked);faceEnabledRef.current=e.target.checked;}} /></label>
      </aside>
      <div className="workspace">
        <div className="workspacehead"><div><span className="breadcrumb">STUDIO / LIVE CANVAS</span><h1>Draw something amazing<span>.</span></h1><p>Move your index finger. Pinch thumb and finger to draw.</p></div><div className="quickactions"><button title="Undo last stroke" onClick={undo}><Undo2 size={17}/></button><button title="Clear canvas" onClick={clear}><Trash2 size={17}/></button><button className="save" onClick={save}><Download size={16}/> Export PNG</button></div></div>
        <div className="canvasframe"><div className="canvastop"><span><span className="dot"/> LIVE CANVAS</span><span>960 × 600 <span className="dim">/</span> {mode.toUpperCase()} MODE</span></div>
          <div className="stage"><video ref={videoRef} muted autoPlay playsInline className={cameraOn?"video visible":"video"} /><div className="gridoverlay"/><canvas ref={drawingRef} width={W} height={H} className="drawing"/><canvas ref={overlayRef} width={W} height={H} className="overlay"/><canvas width={W} height={H} className="mousecanvas" style={{pointerEvents:mode==="mouse"?"auto":"none",touchAction:"none",cursor:mode==="mouse"?"crosshair":"default"}} onPointerDown={e=>{if(mode!=="mouse")return;e.currentTarget.setPointerCapture(e.pointerId);addPoint(mousePoint(e),true);}} onPointerMove={e=>{if(mode==="mouse" && e.buttons===1)addPoint(mousePoint(e),true);}} onPointerUp={()=>finishStroke()} onPointerCancel={()=>finishStroke()}/>
            {!cameraOn && mode==="hand" && <div className="stageempty"><div className="emptyicon"><Hand size={42}/></div><h2>Your canvas is ready</h2><p>Turn on your camera to draw in the air, or switch to mouse mode to try it now.</p><button onClick={startCamera} disabled={loading} className="primary"><Camera size={17}/>{loading?"Loading tracking models...":"Enable camera"}</button></div>}
            {cameraOn && <div className="trackingpill"><span className={tracking?"green":"yellow"}/> {tracking?"Hand detected — pinch to draw":"Show your hand to the camera"}</div>}
          </div><div className="canvasbottom"><div><span className="statusdot"/> {strokesCount} strokes <span className="midpoint">·</span> {faceFound?"Face detected":"Face not detected"}</div><div>PRIVATE & LOCAL <span className="midpoint">·</span> NO VIDEO UPLOADS</div></div></div>
        {error && <div className="error"><span>{error}</span><button onClick={()=>setError("")}><X size={14}/></button></div>}
        <div className="instructions"><div><span className="instructionicon"><Hand size={20}/></span><div><b>01. Show your hand</b><small>Keep it visible in the frame</small></div></div><div><span className="instructionicon"><MousePointer2 size={20}/></span><div><b>02. Pinch to draw</b><small>Touch thumb and index finger</small></div></div><div><span className="instructionicon"><Sparkles size={20}/></span><div><b>03. Create & save</b><small>Release, recognize, or export</small></div></div></div>
      </div>
      <aside className="sidebar rightbar"><div className="asidehead"><span>SMART TOOLS</span><Sparkles size={16}/></div>
        <div className="smartcard"><div className="smarticon"><Type size={20}/></div><b>Air-to-Text</b><p>Write a word in the air, then convert your handwriting into typed text.</p><label className="toggle switchrow"><span>Recognition mode</span><input type="checkbox" checked={wordMode} onChange={e=>setWordMode(e.target.checked)}/></label>
        {wordMode && <><label className="toggle switchrow"><span>Open mouth to recognize</span><input type="checkbox" checked={faceGesture} onChange={e=>{setFaceGesture(e.target.checked);gestureRef.current=e.target.checked;}}/></label><button className="recognize" disabled={reading} onClick={recognize}>{reading?<RefreshCw size={16} className="spin"/>:<Type size={16}/>} {reading?"Recognizing...":"Recognize writing"}</button><div className="result"><small>RECOGNIZED TEXT</small><div>{recognized || "Your text will appear here..."}</div>{recognized && <button title="Copy text" onClick={()=>navigator.clipboard.writeText(recognized)}>Copy text</button>}</div><small className="hint">Handwriting OCR is experimental; write large, clear, separated letters for better results. Face tracking can trigger recognition but cannot read letters itself.</small></>}
        </div><div className="sepline"/><div className="paneltitle">CAMERA CONTROL</div>{cameraOn?<button onClick={stopCamera} className="camerabutton off"><CameraOff size={17}/> Turn camera off</button>:<button onClick={startCamera} disabled={loading} className="camerabutton"><Camera size={17}/>{loading?"Initializing...":"Turn camera on"}</button>}
        <div className="systemstatus"><span>Hand tracker <b className={tracking?"online":"offline"}>{tracking?"ACTIVE":"STANDBY"}</b></span><span>Face tracker <b className={faceFound?"online":"offline"}>{faceFound?"DETECTED":"STANDBY"}</b></span><span>Processing <b>ON DEVICE</b></span></div>
      </aside>
    </section><footer className="footer"><span>AirDraw Studio © 2026</span><span>Built for creativity, powered by computer vision.</span></footer>
  </main>;
}
