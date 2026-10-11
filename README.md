# AirDraw Studio v2

Interactive Next.js + TypeScript drawing studio powered by MediaPipe hand tracking.

## Live demo
https://khurrammunir95.github.io/airdraw/

## Features
- Webcam air drawing: pinch thumb and index finger, move to draw
- 21 hand landmark points and connecting skeleton lines
- Mouse/pointer drawing without webcam
- Eraser radius control, undo, redo, clear canvas
- Neon and solid brushes, colors, PNG export
- Advanced Air-to-Text: stroke bounding-box crop, high-contrast rendering, enlarged writing, multiple Tesseract OCR recognition passes, word/letter modes
- Editable recognition result, alternate readings and opt-in spelling suggestions
- Optional custom vocabulary for correction suggestions
- No face detection or face model downloads

## Recognition limitations
Tesseract is general OCR and is not trained specifically for freehand air writing. Accuracy still depends heavily on letter separation, line width and quality of hand tracking. Suggestions are guesses, never silently substituted. For best results use solid-ink brush, write large block letters, and select Word or Letter mode.

## Local development
```bash
npm install
npm run dev
```
Open http://localhost:3000/airdraw/.

## Deployment
GitHub Actions builds a static Next.js export and copies MediaPipe and OCR model resources into the Pages artifact. Set Settings → Pages → Source to GitHub Actions. Deployment: .github/workflows/deploy.yml.

Camera frames remain on-device, but packaged recognition assets must download to the browser on first use. HTTPS and webcam permission are required for gesture drawing.

## v3 Gesture shortcuts and precision
Keep a recognized hand sign steady for about 0.85 seconds, then release it before triggering again:
- ✌ Victory → eraser
- Three extended fingers → solid-ink brush
- 🖐 Open palm → neon brush
- 👍 Thumbs up → marker brush
- ✊ Fist → undo last change
- 🤏 Thumb-index pinch → draw or erase with the active tool

Adaptive hand-cursor smoothing, stabilization and sampling distance controls help improve line quality. Pinch sensitivity is adjustable. Hand gestures can be disabled. These gestures are geometry-based heuristics, not a perfect sign-language recognizer; lighting, hand orientation and occlusion affect accuracy.
