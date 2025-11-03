# Wraith Wheels — The Night Watcher 🎃🚗

On‑device, privacy‑first drowsiness detection that runs entirely in the browser. Powered by MediaPipe Face Mesh and TensorFlow.js, with an explainable Sleep Predictor and safe escalation (park‑to‑proceed + mini‑game).

<p align="center">
	<em>“Stay awake... or face the pumpkin's curse.”</em>
</p>

---

## Table of contents 📑
- Features
- Tech stack
- Project structure
- Quick start
- How it works
- Controls & configuration
- Models
- Diagnostics & dev scripts
- Training (optional)
- Privacy & safety notes
- Troubleshooting
- Roadmap
- License & credits

## Features ✨
- On‑device only 🔒
	- Camera frames never leave your machine; all compute is in‑browser.
	- Models load from local static files and run with WebGL acceleration when available.
- Eyes: EAR baseline + optional CNN eye classifier 👁️
	- EAR uses standard Eye Aspect Ratio from landmark geometry (left/right) with a tunable threshold and closed‑duration timer.
	- CNN eye model (TFJS) takes 24×48 grayscale crops; the right eye is flipped for consistent orientation.
	- Anti‑blink UX: universal pumpkin show‑delay avoids blink flicker; smooth fade‑out on reopen.
	- Drowsy counter increments only when the overlay becomes visible (not on transient closures).
- Mouth detection and yawn handling 🥱
	- Multi‑class TFJS classifier (neutral/open/smile/yawn) on 64×64 RGB crops; optional binary yawn fallback.
	- Temporal smoothing with short rolling history; requires minimum duration over a probability threshold.
	- Mouth‑opening ratio (MOR) from landmarks gates predictions to cut false positives.
- Head tilt detection 🔄
	- Computes head roll from eye‑line/canonical landmarks; tunable degree threshold and cooldown.
	- Triggers a subtle visual cue (the spooky “hand” animation) to suggest posture correction.
- Sleep Predictor (explainable) 🛌
	- Blends hours awake, approximate sleep debt, circadian sin/cos, and a pre‑dawn bump into a risk score (0–100).
	- Presets: Tuned (more pre‑dawn sensitivity) and Classic (flatter baseline).
	- Modes: Demo (1 sec = 1 min) and Real‑time; supports “jump‑to‑time” for scenario testing.
	- UI shows a risk bar, ETA to bed, and factor chips for explainability.
- Safety escalation flow 🛑
	- “Park to proceed” gate (simulated speed hold) ensures you’re stopped before interaction.
	- Short Simon mini‑game (2 rounds, 45s timer) verifies alertness before resuming.
	- Optional siren audio for stronger escalation.
- Alerts (demo‑friendly) 📍
	- Test button posts location to /api/alert when a backend exists; otherwise shows simulated success for reliable demos.
	- Uses the Geolocation API when available; degrades gracefully offline.
- Diagnostics and dataset capture 🔬📸
	- One‑click CNN diagnostic preloads models and runs a quick self‑check.
	- Dataset Capture Mode lets you press n/o/s/y to export mouth crops to PNG for labeling.
	- Multi‑face: click a face box or use ←/→ to select target; counters reset on switch.

## Tech stack 🧰
- Runtime & tooling ⚙️
	- Vite 5 (vanilla JS, ES modules, fast HMR). CDN imports for MediaPipe/TFJS to keep the bundle lean.
	- Node 18+ recommended. No backend required for core features.
- Computer vision 👁️
	- MediaPipe Face Mesh via CDN (`@mediapipe/face_mesh`, `camera_utils`, `drawing_utils`).
	- Landmark processing computes EAR, MOR, head roll, and face bounding boxes in real‑time.
	- Typical browser FPS: device‑dependent; WebGL improves throughput vs CPU fallback.
- ML runtime (in‑browser) 🧠
	- TensorFlow.js 4.22.0 via CDN (pinned to match converter output). WebGL backend preferred; CPU fallback supported.
	- Memory managed with `tf.tidy()` and explicit disposal of tensors where needed.
	- Compatibility: loader normalizes Keras3/TFJS InputLayer keys (batchInputShape vs inputShape) for robust model.json loading.
- Models 🧪
	- Eye state (binary): `wraith/model/eye_state_model/` — 24×48 grayscale input; sigmoid output.
	- Mouth classifier (4‑class): `wraith/model/mouth_classifier_model/` — 64×64 RGB; softmax output.
	- Yawn fallback (binary): `wraith/model/yawn_model/` — used when multi‑class model isn’t present.
	- All models are TFJS format (model.json + shards) and small enough to commit.
- Training & export (optional) 🚀
	- Python 3 + Keras/TensorFlow; scripts in `wraith/train_*.py` build and train compact CNNs.
	- `tensorflowjs` converter exports TFJS models; a small post‑process step patches model.json InputLayer shapes for browser loaders.
- UI/UX 🎨
	- HTML/CSS with a themed overlay canvas, status grid, and spooky visuals; `Siren.mp3` for audio escalation.
	- Accessible controls with sliders/toggles and clear state badges in a responsive layout.

## Project structure 🧭
```
wraith/
	index.html        # UI shell (loads CDN libs)
	app.js            # Detection pipeline, predictor, overlays, alerts, mini‑game
	styles.css        # UI styles and effects
	Siren.mp3         # Optional escalation audio
	model/            # TFJS models (eye/mouth/yawn) — safe to commit
	data/             # Local datasets (ignored by .gitignore)
	model_export/     # SavedModel/weights (ignored by .gitignore)
	scripts/          # Utilities (e.g., TFJS model.json patch helper)
	vite.config.js    # Vite config
	package.json
```

## Quick start (Windows PowerShell) ⚡
```powershell
cd "wraith"
npm install
npm run dev
# then open the shown URL (default http://localhost:5173/)
```
Grant camera access. Use the sidebar to toggle “AI Vision (CNN)”, “Yawn Detection”, and “Sleep Predictor”.

Browser support: recent Chromium‑based browsers and Safari with WebGL2 enabled.

## How it works 🧠
1) Face landmarks via MediaPipe Face Mesh (runs on device).
2) Eye state via EAR (classical ratio) and/or CNN eye classifier (TFJS).
3) Mouth state via TFJS classifier, gated by mouth‑opening ratio for robustness.
4) Sleep risk via a lightweight model blending hours awake, sleep debt, circadian features, and pre‑dawn bump.
5) Safety UX: a pumpkin overlay triggers after a show‑delay and fades away on recovery. Repeated drowsiness can gate into “park to proceed” and a short Simon mini‑game; optional siren escalates.
6) Alerts: a Test Alert posts to /api/alert; if unavailable, a simulated success updates the UI.

## Controls & configuration 🎛️
- Basic Detection
	- Eye Threshold: EAR threshold (lower = more sensitive to closure).
	- Closed Duration: time eyes must remain closed to trigger overlay.
	- Pumpkin Hide Delay: fade‑out delay after reopening.
	- Pumpkin Show Delay: universal delay to avoid blink flashes.
- AI Vision (CNN)
	- Enable CNN Eye Classifier: toggle the TFJS eye model.
	- CNN Closed Prob: probability threshold to consider closed.
	- CNN Pumpkin Delay: separate show‑delay when using CNN.
	- Enable Mouth Classifier: toggle the mouth TFJS model.
	- Run CNN Diagnostic: preload and run a small self‑check.
- Head Tilt Detection
	- Tilt Threshold / Cooldown: quick posture drift alert.
- Yawn Detection
	- Yawn Probability / Cooldown / Min Mouth Opening / Min Duration.
- Sleep Predictor
	- Persona, Mode (Demo or Real), Preset (Tuned/Classic), Start/Stop.
	- Jump to time (Demo mode only).
- Debug / Capture
	- Dataset Capture Mode: press n/o/s/y to download mouth crops for dataset building.
- Alerts
	- Send Test Location Ping: calls /api/alert or simulates success.

## Models 🧪
- Eye CNN (optional): `wraith/model/eye_state_model/model.json`
- Mouth classifier (preferred, multi‑class): `wraith/model/mouth_classifier_model/model.json`
- Yawn (binary fallback): `wraith/model/yawn_model/model.json`
- TFJS runtime: loaded via CDN in `index.html` and pinned to 4.22.0 to match converter output.

If models are missing, the app runs with EAR‑only eyes and no mouth classifier.

## Diagnostics & dev scripts 🔎
This repo includes small helpers to validate TFJS models and loading paths:
- `test_browser_diag.js` — quick sanity checks in the browser context.
- `test_deserialize_layers.js`, `test_from_memory.js`, `test_inspect_model.js`, `test_load_model.js` — developer utilities for TFJS model loading/inspection.
- `scripts/patch_tfjs_model_json.py` — normalizes Keras3/TFJS InputLayer keys (batchInputShape vs inputShape) for maximum browser compatibility.

## Training (optional) 🏋️
Create a Python venv and install deps:
```powershell
cd "wraith"
python -m venv ..\.venv; ..\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Train mouth classifier (4‑class) and export TFJS:
```powershell
python train_mouth_classifier.py
```

Train eye CNN (open/closed) and export TFJS:
```powershell
python train_eye_cnn.py --epochs 8 --img_w 48 --img_h 24
```
TFJS exports land under `wraith/model/` and are auto‑loaded by the app.

## Privacy & safety notes 🔒
- All computation is on‑device; no frames are uploaded.
- Location ping is a demo: it posts to `/api/alert` when present, else simulates success.
- Always test responsibly and avoid using this as the sole safety system when driving.

## Troubleshooting 🛠️
- Model doesn’t load: ensure TFJS CDN in `index.html` matches the converter (4.22.x) and `model.json` paths exist.
- Slow performance: enable hardware acceleration; lower camera resolution; close other GPU‑intensive tabs.
- Camera blocked: use `https` or `localhost`, and grant permissions in the browser site settings.
- Dev server warning: Vite CJS Node API deprecation is harmless for local dev.

## Roadmap 🗺️
- Auto‑alert threshold UI toggle and persistence.
- Optional metrics export for offline evaluation.
- Additional mini‑game variants for variety.

## License & credits 📜
Licensed under the MIT License — see `LICENSE`.

Credits:
- MediaPipe Face Mesh
- TensorFlow.js
- Icons/overlays are local and rendered client‑side

---

If you use this in a project or demo, a star on GitHub keeps the pumpkin smiling 🎃

