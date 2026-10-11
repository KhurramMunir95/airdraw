# AirDraw Studio

AirDraw is a **Next.js 15 + TypeScript** webcam drawing playground with MediaPipe hand/face tracking and optional handwritten word recognition.

## Live site
https://khurrammunir95.github.io/airdraw/ (becomes available after GitHub Pages is enabled and the deployment workflow succeeds)

## Features
- Draw by pinching your thumb and index finger while moving your hand
- Visible 21-point hand skeleton and connectors
- Face oval, eye and mouth tracking overlays
- Optional *open mouth to recognize* trigger (requires webcam and Air-to-Text mode)
- Air-to-Text experimental OCR using Tesseract.js. **Recognition is based on the drawing, not on face detection.**
- Mouse drawing mode without camera
- Neon and solid brushes, colors, brush size
- Undo, clear, transparent PNG export
- Local webcam processing; no webcam frames are uploaded

## Development
Node.js 20+ recommended.

```bash
npm install
npm run dev
```

Open http://localhost:3000/airdraw

Production build: `npm run build`. Next.js static export writes to `out/`.

## Deploy
The workflow in `.github/workflows/deploy.yml` deploys `out/` on every push to main.

In **Settings → Pages**, select **GitHub Actions** as the build/deployment source. Then review the **Actions** tab and your live URL.

## Notes and limitations
- Camera access requires HTTPS (GitHub Pages provides it) or localhost.
- Hand and face model assets are retrieved from public Google and jsDelivr CDNs when starting the camera; OCR downloads its language resources on first use. Connection is required.
- MediaPipe runs on-device after model loading. Webcam data is not transmitted by this code.
- Small or joined-up handwriting may not OCR reliably. Write clearly and large.
- Face tracking visualizes facial contours; it **cannot independently identify handwritten letters**.
- Best experience is a modern desktop Chrome/Edge browser with a webcam.
- The original source is released as a demonstration. Check third-party library licenses in their respective repositories.
