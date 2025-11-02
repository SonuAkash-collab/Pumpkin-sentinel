// Wraith Wheels — client-side drowsiness detector with jack-o'-lantern overlay
// Uses MediaPipe FaceMesh via CDN (no build step)

const els = {
  video: document.getElementById('video'),
  canvas: document.getElementById('output'),
  videoStage: document.querySelector('.video-stage'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  state: document.getElementById('state'),
  earL: document.getElementById('earL'),
  earR: document.getElementById('earR'),
  cnnL: document.getElementById('cnnL'),
  cnnR: document.getElementById('cnnR'),
  closedTime: document.getElementById('closedTime'),
  msg: document.getElementById('msg'),
  targetFace: document.getElementById('targetFace'),
  threshold: document.getElementById('threshold'),
  thresholdVal: document.getElementById('thresholdVal'),
  duration: document.getElementById('duration'),
  durationVal: document.getElementById('durationVal'),
  hideDelay: document.getElementById('hideDelay'),
  hideDelayVal: document.getElementById('hideDelayVal'),
  pumpkinDelay: document.getElementById('pumpkinDelay'),
  pumpkinDelayVal: document.getElementById('pumpkinDelayVal'),
  tiltThresh: document.getElementById('tiltThresh'),
  tiltThreshVal: document.getElementById('tiltThreshVal'),
  tiltCooldown: document.getElementById('tiltCooldown'),
  tiltCooldownVal: document.getElementById('tiltCooldownVal'),
  yawnThresh: document.getElementById('yawnThresh'),
  yawnThreshVal: document.getElementById('yawnThreshVal'),
  yawnCooldown: document.getElementById('yawnCooldown'),
  yawnCooldownVal: document.getElementById('yawnCooldownVal'),
  yawnMorMin: document.getElementById('yawnMorMin'),
  yawnMorMinVal: document.getElementById('yawnMorMinVal'),
  yawnMinDur: document.getElementById('yawnMinDur'),
  yawnMinDurVal: document.getElementById('yawnMinDurVal'),
  captureMode: document.getElementById('captureMode'),
  useCnn: document.getElementById('useCnn'),
  cnnThresh: document.getElementById('cnnThresh'),
  cnnThreshVal: document.getElementById('cnnThreshVal'),
  cnnPumpkinDelay: document.getElementById('cnnPumpkinDelay'),
  cnnPumpkinDelayVal: document.getElementById('cnnPumpkinDelayVal'),
  useMouthCnn: document.getElementById('useMouthCnn'),
  mouthPred: document.getElementById('mouthPred'),
  drowsyCount: document.getElementById('drowsyCount'),
  // Sleep predictor UI
  sleepPersona: document.getElementById('sleepPersona'),
  sleepSpeed: document.getElementById('sleepSpeed'),
  sleepStartBtn: document.getElementById('sleepStartBtn'),
  sleepStopBtn: document.getElementById('sleepStopBtn'),
  sleepPreset: document.getElementById('sleepPreset'),
  sleepJumpTime: document.getElementById('sleepJumpTime'),
  sleepJumpBtn: document.getElementById('sleepJumpBtn'),
  sleepRisk: document.getElementById('sleepRisk'),
  sleepRiskBar: document.getElementById('sleepRiskBar'),
  sleepEta: document.getElementById('sleepEta'),
  sleepFactors: document.getElementById('sleepFactors'),
  // Mini-game elements
  mgOverlay: document.getElementById('miniGameOverlay'),
  mgStartBtn: document.getElementById('mgStartBtn'),
  mgExitBtn: document.getElementById('mgExitBtn'),
  mgTimer: document.getElementById('mgTimer'),
  mgRound: document.getElementById('mgRound'),
  mgMsg: document.getElementById('mgMsg'),
  // Park banner elements
  parkBanner: document.getElementById('parkBanner'),
  parkSub: document.getElementById('parkSub'),
  parkProceedBtn: document.getElementById('parkProceedBtn'),
  // Alerts test UI
  alertTestBtn: document.getElementById('alertTestBtn'),
  alertStatus: document.getElementById('alertStatus'),
};

const ctx = els.canvas.getContext('2d');
let camera = null; // MediaPipe Camera instance
let fm = null; // FaceMesh
let running = false;
let lastTimestamp = 0;
let closedAccum = 0; // legacy (kept for compatibility) - seconds for target face (not used for gating)
let closedStartMs = 0; // timestamp when target face first detected closed (0 == not currently closed)
let drowsy = false;
let drowsyCount = 0;
let inMiniGame = false;
// palm override removed

// --- Lightweight debug overlay ---
const dbg = { framesSent: 0, results: 0, started: false };
function ensureDebugOverlay(){
  let el = document.getElementById('debugStatus');
  if(!el){
    el = document.createElement('div');
    el.id = 'debugStatus';
    el.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:9999;background:rgba(0,0,0,0.6);color:#0f0;font:12px/1.3 monospace;padding:8px 10px;border:1px solid rgba(0,255,0,0.4);border-radius:8px;pointer-events:none;';
    document.body.appendChild(el);
  }
  return el;
}
function updateDebugOverlay(extra){
  const el = ensureDebugOverlay();
  const fmOk = !!window.FaceMesh;
  const camOk = !!window.Camera;
  el.textContent = `FM:${fmOk?'ok':'no'} CAM:${camOk?'ok':'no'} | started:${dbg.started?'yes':'no'} | frames:${dbg.framesSent} | results:${dbg.results}${extra?` | ${extra}`:''}`;
}

// Hands integration removed

// ==== Mini-game: Short Simon Sequence ====
const simon = {
  pads: [],
  seq: [],
  userIdx: 0,
  round: 1,
  roundsToPass: 2,
  baseLen: 3,
  timerId: null,
  timeLeft: 45, // seconds
  playing: false,
};

function getPadButtons(){
  if(simon.pads.length) return simon.pads;
  if(!els.mgOverlay) return [];
  simon.pads = Array.from(els.mgOverlay.querySelectorAll('.pad'));
  return simon.pads;
}

function setOverlay(show){
  if(!els.mgOverlay) return;
  if(show){ els.mgOverlay.hidden = false; els.mgOverlay.classList.add('show'); }
  else { els.mgOverlay.classList.remove('show'); els.mgOverlay.hidden = true; }
}

function stopMiniGameTimer(){ if(simon.timerId){ clearInterval(simon.timerId); simon.timerId = null; } }

function startMiniGameTimer(){
  stopMiniGameTimer();
  simon.timeLeft = 45;
  if(els.mgTimer) els.mgTimer.textContent = String(simon.timeLeft);
  simon.timerId = setInterval(()=>{
    simon.timeLeft -= 1;
    if(els.mgTimer) els.mgTimer.textContent = String(Math.max(0, simon.timeLeft));
    if(simon.timeLeft <= 0){
      exitMiniGameFail('Time up');
    }
  }, 1000);
}

function flashPad(idx, dur=450){
  const pads = getPadButtons();
  const b = pads[idx]; if(!b) return;
  b.classList.add('active');
  setTimeout(()=>b.classList.remove('active'), dur);
}

function makeSequence(len){
  const seq = [];
  for(let i=0;i<len;i++) seq.push(Math.floor(Math.random()*4));
  return seq;
}

async function playSequence(){
  simon.playing = true;
  if(els.mgMsg) els.mgMsg.textContent = 'Watch…';
  const seq = simon.seq;
  const delay = 650;
  for(let i=0;i<seq.length;i++){
    flashPad(seq[i], 420);
    // wait delay
    /* eslint-disable no-await-in-loop */
    await new Promise(r=>setTimeout(r, delay));
  }
  simon.playing = false;
  simon.userIdx = 0;
  if(els.mgMsg) els.mgMsg.textContent = 'Your turn!';
}

function onPadClick(e){
  if(!inMiniGame || simon.playing) return;
  const idx = Number(e.currentTarget?.dataset?.pad ?? -1);
  if(idx < 0) return;
  flashPad(idx, 150);
  const expected = simon.seq[simon.userIdx];
  if(idx !== expected){
    exitMiniGameFail('Wrong pad');
    return;
  }
  simon.userIdx += 1;
  if(simon.userIdx >= simon.seq.length){
    // completed round
    if(simon.round >= simon.roundsToPass){
      exitMiniGamePass();
    } else {
      simon.round += 1;
      if(els.mgRound) els.mgRound.textContent = String(simon.round);
      simon.seq = makeSequence(simon.baseLen + (simon.round-1));
      setTimeout(playSequence, 600);
    }
  }
}

function enterMiniGame(){
  if(inMiniGame) return;
  inMiniGame = true;
  stopSiren();
  // hide/decay pumpkin while in mini-game
  pumpkinShowing = false; pumpkinFade = 0;
  // setup UI
  setOverlay(true);
  if(els.mgMsg) els.mgMsg.textContent = 'Press Start when ready';
  if(els.mgRound) els.mgRound.textContent = '1';
  const pads = getPadButtons();
  pads.forEach(p=>p.addEventListener('click', onPadClick));
}

function cleanupMiniGame(){
  stopMiniGameTimer();
  const pads = getPadButtons();
  pads.forEach(p=>p.removeEventListener('click', onPadClick));
  setOverlay(false);
  simon.seq = []; simon.userIdx = 0; simon.round = 1; simon.playing = false;
}

function exitMiniGamePass(){
  cleanupMiniGame();
  drowsyCount = 0; if(els.drowsyCount) els.drowsyCount.textContent = '0';
  if(els.mgMsg) els.mgMsg.textContent = '';
  inMiniGame = false;
}

function exitMiniGameFail(reason=''){
  if(els.mgMsg) els.mgMsg.textContent = reason ? `Fail: ${reason}` : 'Failed';
  // keep count as-is; can escalate alerts if desired
  cleanupMiniGame();
  inMiniGame = false;
}

function startSimon(){
  if(!inMiniGame) return;
  startMiniGameTimer();
  simon.round = 1; if(els.mgRound) els.mgRound.textContent = '1';
  simon.seq = makeSequence(simon.baseLen);
  playSequence();
}

// ---- Geolocation stop-gating (park before mini-game) ----
let awaitingStop = false;
let geoWatchId = null;
let lastPosForSpeed = null; // {lat, lon, t}
let stopStartMs = 0;

function showParkBanner(message){
  if(!els.parkBanner) return;
  els.parkBanner.hidden = false;
  els.parkBanner.classList.add('show');
  if(els.parkSub) els.parkSub.textContent = message || 'Waiting for GPS and for the vehicle to stop…';
}

function hideParkBanner(){
  if(!els.parkBanner) return;
  els.parkBanner.classList.remove('show');
  els.parkBanner.hidden = true;
  if(els.parkSub) els.parkSub.textContent = '';
}

function clearStopGate(){
  if(geoWatchId != null){
    try{ navigator.geolocation.clearWatch(geoWatchId); }catch(_){ }
    geoWatchId = null;
  }
  awaitingStop = false;
  lastPosForSpeed = null;
  stopStartMs = 0;
}

function haversineMeters(lat1, lon1, lat2, lon2){
  const R = 6371000; // meters
  const toRad = (x)=>x*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}

function computeSpeedMps(pos){
  // Prefer native speed if sensible; else estimate from successive positions
  let v = pos?.coords?.speed;
  if(typeof v === 'number' && isFinite(v) && v >= 0 && v < 120){
    return v; // m/s
  }
  const lat = pos?.coords?.latitude, lon = pos?.coords?.longitude;
  const t = pos?.timestamp ? (pos.timestamp) : Date.now();
  if(lastPosForSpeed && typeof lat === 'number' && typeof lon === 'number'){
    const dt = (t - lastPosForSpeed.t)/1000; // seconds
    if(dt > 0.3 && dt < 30){
      const d = haversineMeters(lastPosForSpeed.lat, lastPosForSpeed.lon, lat, lon);
      v = d / dt;
    }
  }
  if(typeof lat === 'number' && typeof lon === 'number'){
    lastPosForSpeed = { lat, lon, t };
  }
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

function waitForVehicleStop(options={}){
  const speedThresh = options.speed ?? 1.5; // m/s (~5.4 km/h)
  const holdSeconds = options.holdSeconds ?? 5;
  const timeoutMs = options.timeoutMs ?? 60000;
  awaitingStop = true;
  showParkBanner('Please park on the side and take the test.');

  return new Promise((resolve, reject)=>{
    if(!('geolocation' in navigator)){
      if(els.parkSub) els.parkSub.textContent = 'Geolocation not available. You can proceed manually.';
      awaitingStop = false;
      return reject(new Error('GeolocationUnavailable'));
    }
    let timeoutId = null;
    const clearAll = ()=>{
      if(timeoutId){ clearTimeout(timeoutId); timeoutId = null; }
      clearStopGate();
    };
    timeoutId = setTimeout(()=>{
      if(els.parkSub) els.parkSub.textContent = 'Taking too long. You can proceed manually when parked.';
      clearAll();
      reject(new Error('StopTimeout'));
    }, timeoutMs);

    const onPos = (pos)=>{
      if(!awaitingStop) return;
      const acc = pos?.coords?.accuracy ?? 9999;
      const fresh = (Date.now() - (pos?.timestamp ?? Date.now())) < 20000; // <20s old
      const v = computeSpeedMps(pos);
      if(!fresh || acc > 50 || v == null){
        stopStartMs = 0;
        if(els.parkSub){
          const reason = !fresh ? 'Waiting for fresh GPS…' : (acc>50 ? `Improving accuracy (${Math.round(acc)}m)…` : 'Waiting for GPS fix…');
          els.parkSub.textContent = reason;
        }
        return;
      }

      if(v <= speedThresh){
        if(stopStartMs === 0) stopStartMs = Date.now();
        const held = (Date.now() - stopStartMs)/1000;
        if(els.parkSub) els.parkSub.textContent = `Vehicle stopped. Hold ${Math.max(0, holdSeconds - held).toFixed(0)}s…`;
        if(held >= holdSeconds){
          clearAll();
          resolve();
        }
      } else {
        stopStartMs = 0;
        if(els.parkSub) els.parkSub.textContent = `Speed ${v.toFixed(1)} m/s. Please park and hold still…`;
      }
    };
    const onErr = (err)=>{
      if(els.parkSub){
        if(err?.code === 1){ // PERMISSION_DENIED
          els.parkSub.textContent = 'Location permission denied. You can proceed manually when parked.';
        } else {
          els.parkSub.textContent = 'Location unavailable. You can proceed manually when parked.';
        }
      }
      clearAll();
      reject(err || new Error('GeolocationError'));
    };

    try{
      geoWatchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }catch(e){ onErr(e); }
  });
}
let targetIndexUser = null; // if user manually selects a face index
let lastFaceBoxes = []; // store boxes for hit testing
let lastFacesLandmarks = []; // recent multiFaceLandmarks from FaceMesh
let lastEyesClosedAtMs = 0; // timestamp when eyes were last detected closed (target)
let pumpkinShowing = false; // overlay visibility state tied to target face
let pumpkinFade = 0; // 0..1 fade factor for pumpkin (decay on hide)
const PUMPKIN_FADE_IN_SEC = 0.18;
const PUMPKIN_FADE_OUT_SEC = 0.65; // slower == decaying feel

// Audio: external siren playback state
let __sirenAudio = null; // HTMLAudioElement singleton
let __sirenTimer = null; // timeout id to cap playback duration

function stopSiren(){
  try{
    if(__sirenTimer){ clearTimeout(__sirenTimer); __sirenTimer = null; }
    if(__sirenAudio){ __sirenAudio.pause(); __sirenAudio.currentTime = 0; }
  }catch(_){ }
}

// Head tilt and skeleton hand settings/state
let TILT_THRESHOLD_RAD = 0.21; // default ~12°
let TILT_COOLDOWN_MS = 2500;  // default cooldown
let handAnim = null; // { side: 'left'|'right', startMs: number }
let lastHandTriggerMs = 0;
// Require head tilt to be held while eyes closed before ghost pushes
let TILT_HOLD_MS = 1500; // 1.5s
let tiltHoldStartMs = 0;
let tiltHoldSide = null;

// Ghost asset (base facing right). We'll mirror for RIGHT so it faces inward.
const handImg = new Image();
handImg.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200">
  <defs>
    <radialGradient id="ghostBody" cx="50%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="70%" stop-color="#e6ecff"/>
      <stop offset="100%" stop-color="#c7d3ff"/>
    </radialGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#a4b8ff" flood-opacity="0.6"/>
    </filter>
  </defs>
  <g filter="url(#glow)">
    <!-- ghost body -->
    <path d="M60 150 C 40 120, 40 70, 85 45 C 130 20, 190 40, 195 95 C 200 150, 188 165, 170 150 C 158 160, 142 160, 130 148 C 118 160, 98 160, 85 150 C 76 158, 66 158, 60 150 Z" fill="url(#ghostBody)" stroke="#8fa0d8" stroke-width="3"/>
    <!-- eyes and mouth -->
    <ellipse cx="120" cy="90" rx="10" ry="14" fill="#1f2a44"/>
    <ellipse cx="154" cy="92" rx="10" ry="14" fill="#1f2a44"/>
    <path d="M118 116 C 128 128, 148 128, 158 116" fill="none" stroke="#1f2a44" stroke-width="5" stroke-linecap="round"/>
  </g>
</svg>
`);

function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function drawSkeletonHand(side, t, bbox, phase, phaseT){
  if(!handImg.complete) return;
  const cw = els.canvas.width, ch = els.canvas.height;
  // Scale hand relative to face height
  const handH = Math.max(80, bbox.h * 0.9);
  const aspect = 240/200; // from viewBox
  const handW = handH * aspect;

  // Base Y position: slightly lower for left side to simulate pushing under the jaw
  const yBase = (side === 'left')
    ? (bbox.y + bbox.h*0.62 - handH*0.5)
    : (bbox.y + bbox.h*0.5 - handH*0.5);
  let xStart, xFinal;
  if(side === 'left'){
    xStart = -handW - 10; // from left edge
    // Stop farther from face so it doesn't overlap too much
    xFinal = Math.max(10, bbox.x - handW*0.6);
  } else {
    xStart = cw + 10; // from right edge
    xFinal = Math.min(cw - handW - 10, bbox.x + bbox.w - handW*0.2);
  }
  const te = easeOutCubic(t);
  const xNow = xStart + (xFinal - xStart) * te;

  // Upward push motion during hold phase (and ease out on retract)
  let yNow = yBase;
  if(side === 'left'){
    let push = 0;
    if(phase === 'hold'){
      push = -bbox.h * 0.08 * easeOutCubic(Math.min(1, Math.max(0, phaseT)));
    } else if(phase === 'out'){
      // fade the push out
      push = -bbox.h * 0.08 * easeOutCubic(Math.max(0, 1 - phaseT));
    }
    yNow += push;
  }

  ctx.save();
  ctx.globalAlpha = 0.95;
  // Face the ghost inward: entering from LEFT uses base (right-facing);
  // entering from RIGHT mirrors the image (left-facing)
  if(side === 'right'){
    ctx.translate(xNow + handW, yNow);
    ctx.scale(-1, 1);
    // slight inward rotation
    ctx.translate(handW*0.03, handH*0.02);
    ctx.rotate(-4 * Math.PI/180);
    ctx.drawImage(handImg, 0, 0, handW, handH);
  } else {
    ctx.translate(xNow, yNow);
    ctx.rotate(2 * Math.PI/180);
    ctx.drawImage(handImg, 0, 0, handW, handH);
  }
  ctx.restore();
}

function updateAndDrawHand(now, bbox){
  if(!handAnim || !bbox) return;
  const inDur = 450, holdDur = 600, outDur = 450;
  const elapsed = now - handAnim.startMs;
  const total = inDur + holdDur + outDur;
  if(elapsed >= total){
    handAnim = null;
    return;
  }
  let t, phase, phaseT;
  if(elapsed < inDur){
    t = elapsed / inDur;
    phase = 'in';
    phaseT = t;
  } else if(elapsed < inDur + holdDur){
    t = 1;
    phase = 'hold';
    phaseT = (elapsed - inDur) / holdDur;
  } else {
    const outT = (elapsed - inDur - holdDur) / outDur;
    t = 1 - outT; // retract
    phase = 'out';
    phaseT = outT;
  }
  t = Math.max(0, Math.min(1, t));
  drawSkeletonHand(handAnim.side, t, bbox, phase, phaseT);
}

// Yawn detection: use mouth opening ratio (vertical / face height or mouth width)
let lastYawnMs = 0;
let yawnHoldStartMs = 0; // require persistence above thresholds to confirm yawn
let eyePopAnim = null; // { startMs, x, y }
const eyeImg = new Image();
eyeImg.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
  <defs>
    <radialGradient id="iris" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#33aaff"/>
      <stop offset="60%" stop-color="#0066aa"/>
      <stop offset="100%" stop-color="#003366"/>
    </radialGradient>
  </defs>
  <circle cx="80" cy="80" r="70" fill="#f5f5f5" stroke="#111" stroke-width="6"/>
  <circle cx="80" cy="80" r="36" fill="url(#iris)" stroke="#0a2236" stroke-width="4"/>
  <circle cx="80" cy="80" r="18" fill="#000"/>
  <circle cx="62" cy="62" r="10" fill="#fff"/>
</svg>
`);

function drawEyePop(now, x, y, faceBox, mor){
  if(!eyeImg.complete) return;
  const inDur = 300, holdDur = 500, outDur = 400;
  const elapsed = now - eyePopAnim.startMs;
  const total = inDur + holdDur + outDur;
  if(elapsed >= total){ eyePopAnim = null; return; }

  let t;
  if(elapsed < inDur) t = elapsed / inDur;
  else if(elapsed < inDur+holdDur) t = 1;
  else t = 1 - (elapsed - inDur - holdDur) / outDur;
  t = Math.max(0, Math.min(1, t));

  // Scale eye relative to face and mouth openness
  const base = Math.max(40, faceBox.h * 0.22);
  const opennessScale = 0.8 + Math.min(1.2, Math.max(0, mor)) * 0.6; // 0.8..1.52 range
  const animScale = 0.7 + 0.3 * t; // subtle grow-in
  const size = base * opennessScale * animScale;
  const yOffset = -faceBox.h * 0.10 * t; // pop upward a bit

  // Wobble around the mouth center while following it
  const time = now / 1000;
  const wobbleAx = faceBox.w * 0.015; // horizontal amplitude
  const wobbleAy = faceBox.h * 0.02;  // vertical amplitude
  const wx = Math.sin(time * 7.5) * wobbleAx;
  const wy = Math.cos(time * 6.0) * wobbleAy;
  ctx.save();
  ctx.globalAlpha = 0.98;
  ctx.translate(x - size/2 + wx, y - size/2 + yOffset + wy);
  ctx.drawImage(eyeImg, 0, 0, size, size);
  ctx.restore();
}

function mouthOpenRatio(lm){
  // Use top lip (13), bottom lip (14) for vertical; left (61) and right (291) for width
  const top = lm[13], bottom = lm[14], left = lm[61], right = lm[291];
  if(!(top&&bottom&&left&&right)) return 0;
  const vert = dist2D(top, bottom);
  const width = dist2D(left, right);
  if(width <= 1e-6) return 0;
  return vert / width; // larger when mouth opens wide
}

function mouthCenterCanvas(lm){
  const top = lm[13], bottom = lm[14];
  if(!(top && bottom)) return null;
  const cx = (top.x + bottom.x)/2 * els.canvas.width;
  const cy = (top.y + bottom.y)/2 * els.canvas.height;
  return {cx, cy};
}

// Preload jack-o'-lantern image (simple emoji or inline SVG). We'll draw a stylized pumpkin.
const pumpkin = new Image();
pumpkin.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 260">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#ffcc33"/>
      <stop offset="70%" stop-color="#ff8800"/>
      <stop offset="100%" stop-color="#cc5500"/>
    </radialGradient>
  </defs>
  <ellipse cx="150" cy="130" rx="130" ry="100" fill="url(#g)" stroke="#552200" stroke-width="6"/>
  <rect x="135" y="10" width="30" height="40" rx="6" fill="#6b8e23" stroke="#3a5f0b" stroke-width="6"/>
  <path d="M70 140 L110 110 L150 140 Z" fill="#1a1000"/>
  <path d="M230 140 L190 110 L150 140 Z" fill="#1a1000"/>
  <path d="M100 180 C130 160 170 160 200 180 C175 205 125 205 100 180 Z" fill="#1a1000"/>
</svg>
`);

function lerp(a,b,t){ return a+(b-a)*t; }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

// ===================== CNN eye-state classifier (TF.js) =====================
// A tiny CNN that takes a grayscale eye crop (e.g., 24x48 HxW) and outputs P(closed)
// We'll support both eyes by flipping the right eye horizontally so the network sees consistent orientation.
let eyeModel = null; // tf.LayersModel
const EYE_H = 24;
const EYE_W = 48; // width > height to cover typical eye shape
const EYE_PAD = 1.6; // scale the eye bbox a bit
const CNN_SMOOTH_WIN = 5; // temporal smoothing window size
const probHist = { L: [], R: [] };
let PUMPKIN_CNN_SHOW_DELAY_SEC = 1.2; // wait this long with eyes closed (CNN) before showing pumpkin
let PUMPKIN_SHOW_DELAY_SEC = 1.2; // universal delay (seconds) before showing pumpkin to avoid blinks

async function loadEyeModel(){
  if(eyeModel) return eyeModel;
  const rel = 'model/eye_state_model/model.json';
  const fullUrl = (typeof location !== 'undefined') ? (new URL(rel, location.href)).href : rel;
  // retry loader with exponential backoff
  async function tryLoad(url, attempts=4){
    let lastErr = null;
    for(let i=1;i<=attempts;i++){
      try{
        console.log(`loading model ${url} attempt ${i}`);
        const m = await tf.loadLayersModel(url);
        return m;
      }catch(err){
        lastErr = err;
        console.warn(`load attempt ${i} failed for ${url}:`, err?.message || err);
        // small backoff
        await new Promise(r=>setTimeout(r, 150 * Math.pow(2, i-1)));
      }
    }
    throw lastErr;
  }

  try{
    eyeModel = await tryLoad(rel, 4);
    console.log('Eye CNN loaded');
  }catch(err){
    console.warn('Eye CNN load failed, trying compat loader:', err?.message || err);
    try{
      // try compat path (which fetches model.json and shards manually)
      eyeModel = await loadLayersModelCompat('model/eye_state_model/');
      console.log('Eye CNN loaded via compat loader');
    }catch(e2){
      console.warn('Eye CNN not available:', e2?.message || e2);
      eyeModel = null;
    }
  }
  return eyeModel;
}

// ------------------ Mouth classifier ------------------
let mouthModel = null;
const MOUTH_W = 64, MOUTH_H = 64;
const MOUTH_SMOOTH_WIN = 6;
let mouthHist = [];
// history buffers for mouth model smoothing (vector and scalar outputs)
let mouthHistVec = [];
let mouthHistScalar = [];

async function loadMouthModel(){
  if(mouthModel) return mouthModel;
  // helper to try a URL with retries
  async function tryLoad(url, attempts=4){
    let lastErr = null;
    for(let i=1;i<=attempts;i++){
      try{
        console.log(`loading model ${url} attempt ${i}`);
        const m = await tf.loadLayersModel(url);
        return m;
      }catch(err){
        lastErr = err;
        console.warn(`load attempt ${i} failed for ${url}:`, err?.message || err);
        await new Promise(r=>setTimeout(r, 150 * Math.pow(2, i-1)));
      }
    }
    throw lastErr;
  }

  // Prefer multi-class mouth classifier first
  try{
    mouthModel = await tryLoad('model/mouth_classifier_model/model.json', 3);
    mouthModel._yawnBinary = false;
    console.log('Loaded multi-class mouth model');
    return mouthModel;
  }catch(_){ /* try fallback */ }

  // Fallback to binary yawn model
  try{
    mouthModel = await tryLoad('model/yawn_model/model.json', 3);
    mouthModel._yawnBinary = true;
    console.log('Loaded binary yawn model');
    return mouthModel;
  }catch(e){
    console.warn('Mouth CNN load failed, trying compat loaders:', e?.message || e);
    // Try compat path for multi-class first
    try{
      mouthModel = await loadLayersModelCompat('model/mouth_classifier_model/');
      mouthModel._yawnBinary = false;
      console.log('Loaded multi-class mouth model via compat');
      return mouthModel;
    }catch(eMC){
      try{
        mouthModel = await loadLayersModelCompat('model/yawn_model/');
        mouthModel._yawnBinary = true;
        console.log('Loaded binary yawn model via compat');
        return mouthModel;
      }catch(eBY){
        console.warn('Mouth CNN not available after compat attempts:', eBY?.message || eBY);
        mouthModel = null;
      }
    }
  }
  return mouthModel;
}

// ---- Compat model loader for Keras 3 -> TFJS naming differences ----
// Some converted models (Keras 3 + tfjs-converter 4.20) use `batch_shape` in InputLayer,
// while tfjs-layers expects `batchInputShape`/`inputShape`. This loader fixes the JSON in-memory
// and provides weights via fromMemory IOHandler.
async function loadLayersModelCompat(baseDir){
  // Ensure baseDir ends with '/'
  const dir = baseDir.endsWith('/') ? baseDir : (baseDir + '/');
  const jsonUrl = dir + 'model.json';
  const res = await fetch(jsonUrl);
  if(!res.ok) throw new Error(`Failed to fetch ${jsonUrl}: ${res.status}`);
  const modelJSON = await res.json();
  // Patch InputLayer config fields
  try{
    const layers = modelJSON?.modelTopology?.model_config?.config?.layers;
    if(Array.isArray(layers) && layers.length){
      // Normalize InputLayer config variants (batch_shape / input_shape -> batchInputShape/inputShape)
      const inp = layers.find(l=>l?.class_name === 'InputLayer') || layers[0];
      const cfg = inp?.config || {};
      const b = cfg.batch_shape || cfg.batchShape || cfg.batch_input_shape || cfg.batchInputShape;
      if (b) {
        cfg.batchInputShape = b;
        delete cfg.inputShape;
        delete cfg.input_shape;
        delete cfg.batch_input_shape;
        delete cfg.batch_shape;
        delete cfg.batchShape;
      } else {
        const inpShape = cfg.input_shape || cfg.inputShape;
        if (inpShape && !cfg.inputShape) cfg.inputShape = inpShape;
      }
      inp.config = cfg;

      // Convert Keras v3 inbound_nodes (objects with args/kwargs) into the
      // legacy nested-array format TF.js expects. Example v3 inbound_nodes:
      //  [{"args":[{"class_name":"__keras_tensor__","config":{"keras_history":["layer",0,0]}}],"kwargs":{}}]
      // Convert each such node to: [["layer",0,0,{}]]
      for(const layer of layers){
        const inb = layer?.inbound_nodes;
        if(Array.isArray(inb) && inb.length){
          // detect v3 style: first element is an object with args/kwargs
          if(typeof inb[0] === 'object' && (inb[0].hasOwnProperty('args') || inb[0].hasOwnProperty('kwargs'))){
            try{
              const newNodes = [];
              for(const nodeObj of inb){
                const args = Array.isArray(nodeObj.args) ? nodeObj.args : [];
                const kwargs = (nodeObj.kwargs && typeof nodeObj.kwargs === 'object') ? nodeObj.kwargs : {};
                const lane = [];
                for(const a of args){
                  // Expect __keras_tensor__ entries with keras_history: [layerName, index, tensorIndex]
                  const cfgA = a && a.config;
                  const history = Array.isArray(cfgA?.keras_history) ? cfgA.keras_history : null;
                  if(history && history.length >= 3){
                    lane.push([ history[0], history[1], history[2], kwargs ]);
                  } else if(typeof a === 'string'){
                    // fallback if it's already a simple spec
                    lane.push([a, 0, 0, kwargs]);
                  }
                }
                if(lane.length) newNodes.push(lane);
              }
              // Only replace if we constructed something reasonable
              if(newNodes.length) layer.inbound_nodes = newNodes;
            }catch(_e){
              // If conversion fails, leave inbound_nodes as-is and continue
              console.warn('inbound_nodes conversion failed for layer', layer?.name, _e?.message || _e);
            }
          }
        }
      }
    }
  }catch(e){
    console.warn('Compat patch failed (proceeding):', e?.message || e);
  }
  // Gather weights
  const manifests = modelJSON?.weightsManifest || [];
  const weightSpecs = [];
  const parts = [];
  for(const group of manifests){
    const paths = group.paths || [];
    for(const p of paths){
      const url = dir + p;
      const wRes = await fetch(url);
      if(!wRes.ok) throw new Error(`Failed to fetch ${url}: ${wRes.status}`);
      parts.push(await wRes.arrayBuffer());
    }
    if(Array.isArray(group.weights)) weightSpecs.push(...group.weights);
  }
  // Concatenate into a single ArrayBuffer as expected by fromMemory
  let total = 0; for(const ab of parts) total += ab.byteLength;
  const weightData = new Uint8Array(total);
  let off = 0; for(const ab of parts){ weightData.set(new Uint8Array(ab), off); off += ab.byteLength; }
  const ioHandler = tf.io.fromMemory({ modelTopology: modelJSON.modelTopology, weightSpecs, weightData: weightData.buffer });
  return tf.loadLayersModel(ioHandler);
}

function cropMouthFromCanvas(box, canvasEl){
  const cw = canvasEl.width, ch = canvasEl.height;
  const x = clamp((box.cx - box.w/2) * cw, 0, cw-1);
  const y = clamp((box.cy - box.h/2) * ch, 0, ch-1);
  const w = clamp(box.w * cw, 4, cw);
  const h = clamp(box.h * ch, 4, ch);
  const off = cropMouthFromCanvas._off || (cropMouthFromCanvas._off = document.createElement('canvas'));
  off.width = MOUTH_W; off.height = MOUTH_H;
  const octx = off.getContext('2d');
  octx.drawImage(canvasEl, x, y, w, h, 0, 0, MOUTH_W, MOUTH_H);
  const img = octx.getImageData(0,0,MOUTH_W,MOUTH_H);
  // convert to float32 [H,W,3]
  const buf = new Float32Array(MOUTH_W * MOUTH_H * 3);
  for(let i=0, j=0;i<img.data.length;i+=4,j+=3){
    buf[j]   = img.data[i] / 255.0;
    buf[j+1] = img.data[i+1] / 255.0;
    buf[j+2] = img.data[i+2] / 255.0;
  }
  return tf.tensor(buf, [MOUTH_H, MOUTH_W, 3]);
}

function smoothMouthPred(vec){
  mouthHistVec.push(vec);
  if(mouthHistVec.length > MOUTH_SMOOTH_WIN) mouthHistVec.shift();
  const sum = mouthHistVec.reduce((a,b)=>a.map((v,i)=>v+b[i]), new Array(vec.length).fill(0));
  return sum.map(v=>v/mouthHistVec.length);
}

function smoothMouthScalar(v){
  mouthHistScalar.push(v);
  if(mouthHistScalar.length > MOUTH_SMOOTH_WIN) mouthHistScalar.shift();
  const s = mouthHistScalar.reduce((a,b)=>a+b, 0) / mouthHistScalar.length;
  return s;
}

function landmarksEyeBox(lm, eye){
  // Build a small box around eye using its corner landmarks
  const left = lm[eye.left];
  const right = lm[eye.right];
  const upper = {
    x:(lm[eye.upper[0]].x + lm[eye.upper[1]].x)/2,
    y:(lm[eye.upper[0]].y + lm[eye.upper[1]].y)/2,
  };
  const lower = {
    x:(lm[eye.lower[0]].x + lm[eye.lower[1]].x)/2,
    y:(lm[eye.lower[0]].y + lm[eye.lower[1]].y)/2,
  };
  const cx = (left.x + right.x)/2;
  const cy = (upper.y + lower.y)/2;
  const w = Math.abs(right.x - left.x);
  const h = Math.abs(lower.y - upper.y) * 2.2; // slightly taller than lids
  const padW = w * EYE_PAD;
  const padH = h * EYE_PAD;
  return { cx, cy, w: padW, h: padH };
}

function cropEyeToTensor(sourceImage, box){
  // box in normalized coords (0..1)
  const cw = els.canvas.width, ch = els.canvas.height;
  const x = clamp((box.cx - box.w/2) * cw, 0, cw-1);
  const y = clamp((box.cy - box.h/2) * ch, 0, ch-1);
  const w = clamp(box.w * cw, 4, cw);
  const h = clamp(box.h * ch, 4, ch);

  // Use an offscreen canvas to draw the crop
  const off = cropEyeToTensor._off || (cropEyeToTensor._off = document.createElement('canvas'));
  off.width = EYE_W; off.height = EYE_H;
  const octx = off.getContext('2d');
  // Draw from the main canvas (which already has the frame rendered) to ensure coords align
  octx.drawImage(sourceImage, x, y, w, h, 0, 0, EYE_W, EYE_H);
  // Grayscale and normalize to [0,1]
  const imgData = octx.getImageData(0,0,EYE_W,EYE_H);
  const data = imgData.data;
  const gray = new Float32Array(EYE_W * EYE_H);
  for(let i=0, j=0; i<data.length; i+=4, j++){
    const r=data[i], g=data[i+1], b=data[i+2];
    gray[j] = (0.299*r + 0.587*g + 0.114*b) / 255;
  }
  const t = tf.tensor(gray, [EYE_H, EYE_W, 1]);
  return t;
}

function flipTensorLeftRight(x){
  // x: [H,W,1]
  return tf.tidy(()=>x.reverse(1));
}

function smoothProb(side, p){
  const h = probHist[side];
  h.push(p);
  if(h.length > CNN_SMOOTH_WIN) h.shift();
  const avg = h.reduce((a,b)=>a+b, 0) / h.length;
  return avg;
}

// Eye Aspect Ratio like metric using MediaPipe FaceMesh indices
// We'll use eye landmark sets approximated from MediaPipe indexes
const LEFT_EYE = { // key pairs approximating vertical distances and horizontal width
  upper:[386,385], lower:[374,380], // near top/bottom eyelid center-ish
  left: 263, right: 362
};
const RIGHT_EYE = {
  upper:[159,158], lower:[145,153],
  left: 133, right: 33
};

function dist2D(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

function earForEye(landmarks, eye){
  const u = {
    x:(landmarks[eye.upper[0]].x + landmarks[eye.upper[1]].x)/2,
    y:(landmarks[eye.upper[0]].y + landmarks[eye.upper[1]].y)/2,
  };
  const l = {
    x:(landmarks[eye.lower[0]].x + landmarks[eye.lower[1]].x)/2,
    y:(landmarks[eye.lower[0]].y + landmarks[eye.lower[1]].y)/2,
  };
  const left = landmarks[eye.left];
  const right = landmarks[eye.right];
  const vert = dist2D(u,l);
  const horiz = dist2D(left,right);
  if (horiz <= 1e-6) return 0;
  return vert / horiz; // smaller when eye closed
}

function drawEyeMarkers(landmarks, eye, color){
  const cw = els.canvas.width, ch = els.canvas.height;
  const u = {
    x:(landmarks[eye.upper[0]].x + landmarks[eye.upper[1]].x)/2,
    y:(landmarks[eye.upper[0]].y + landmarks[eye.upper[1]].y)/2,
  };
  const l = {
    x:(landmarks[eye.lower[0]].x + landmarks[eye.lower[1]].x)/2,
    y:(landmarks[eye.lower[0]].y + landmarks[eye.lower[1]].y)/2,
  };
  const left = landmarks[eye.left];
  const right = landmarks[eye.right];
  const pts = [u,l,left,right];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  // corners line
  ctx.beginPath();
  ctx.moveTo(left.x*cw, left.y*ch);
  ctx.lineTo(right.x*cw, right.y*ch);
  ctx.stroke();
  // vertical line
  ctx.beginPath();
  ctx.moveTo(u.x*cw, u.y*ch);
  ctx.lineTo(l.x*cw, l.y*ch);
  ctx.stroke();
  // dots
  for(const p of pts){
    ctx.beginPath();
    ctx.arc(p.x*cw, p.y*ch, 3, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function boo(){
  // Play external Siren.mp3 for up to ~30 seconds, then stop.
  // Place the file at one of these locations (recommended listed first):
  //   1) wraith/public/Siren.mp3  -> served as "/Siren.mp3" by Vite
  //   2) wraith/public/sounds/Siren.mp3 -> served as "/sounds/Siren.mp3"
  // If not present, we fall back to a short beep.

  // Duration policy: default ~3s, escalate to ~10s if drowsyCount > 3
  const BASE_MAX_MS = 3000;
  const ESCALATE_MAX_MS = 10000;
  const MAX_MS = (typeof drowsyCount === 'number' && drowsyCount > 3) ? ESCALATE_MAX_MS : BASE_MAX_MS;
  const candidates = [
    '/Siren.mp3',
    '/sounds/Siren.mp3',
    'Siren.mp3', // relative (if placed next to index.html)
  ];

  // Stop any previous playback
  try{
    if(__sirenTimer){ clearTimeout(__sirenTimer); __sirenTimer = null; }
    if(__sirenAudio){ __sirenAudio.pause(); __sirenAudio.currentTime = 0; }
  }catch(_){ }

  // Create or reuse audio element
  if(!__sirenAudio){ __sirenAudio = new Audio(); __sirenAudio.preload = 'auto'; __sirenAudio.loop = true; }

  // Try candidate sources in order; use the first that loads successfully.
  let tried = 0;
  const tryNext = ()=>{
    if(tried >= candidates.length){
      // Fallback beep
      try{ const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); const g = ac.createGain(); o.type='sine'; o.frequency.setValueAtTime(880, ac.currentTime); g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.linearRampToValueAtTime(0.3, ac.currentTime+0.02); g.gain.linearRampToValueAtTime(0.0001, ac.currentTime+0.4); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime+0.4);}catch(_){ }
      return;
    }
    const src = candidates[tried++];
    __sirenAudio.src = src;
    const onCanPlay = async ()=>{
      __sirenAudio.removeEventListener('canplaythrough', onCanPlay);
      __sirenAudio.removeEventListener('error', onError);
      try{
        await __sirenAudio.play();
        // Cap duration
        __sirenTimer = setTimeout(()=>{
          try{ __sirenAudio.pause(); __sirenAudio.currentTime = 0; }catch(_){ }
          __sirenTimer = null;
        }, MAX_MS);
      }catch(e){
        // Autoplay blocked or other issue: try next source
        tryNext();
      }
    };
    const onError = ()=>{
      __sirenAudio.removeEventListener('canplaythrough', onCanPlay);
      __sirenAudio.removeEventListener('error', onError);
      tryNext();
    };
    __sirenAudio.addEventListener('canplaythrough', onCanPlay, { once: false });
    __sirenAudio.addEventListener('error', onError, { once: false });
    // Kick off load
    __sirenAudio.load();
  };

  tryNext();
}

function setState(text){ els.state.textContent = text; }

function drawPumpkinOverFace(landmarks, alpha=1){
  // Determine face bounding box and orientation using a few key points
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];
  const chin = landmarks[152];
  const forehead = landmarks[10];

  if(!leftCheek || !rightCheek || !chin || !forehead) return;

  const center = {
    x: (leftCheek.x + rightCheek.x)/2,
    y: (chin.y + forehead.y)/2,
  };
  const width = dist2D(leftCheek, rightCheek);
  const height = dist2D(forehead, chin);
  const angle = Math.atan2(rightCheek.y - leftCheek.y, rightCheek.x - leftCheek.x);

  const cw = els.canvas.width;
  const ch = els.canvas.height;

  if(alpha <= 0) return;
  ctx.save();
  ctx.translate(center.x * cw, center.y * ch);
  ctx.rotate(angle);
  // decaying scale: slightly smaller as alpha approaches 0
  const scaleBase = 1.35;
  const scale = scaleBase * (0.96 + 0.06 * alpha);
  const w = width * cw * scale;
  const h = height * ch * scale;
  ctx.globalAlpha = 0.92 * Math.max(0, Math.min(1, alpha));
  ctx.drawImage(pumpkin, -w/2, -h*0.55, w, h*1.1);
  ctx.restore();
}

function drawFaceBox(landmarks, index, highlight=false, state='neutral'){
  // Compute tight bounding box
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const p of landmarks){
    if(p.x<minX) minX=p.x; if(p.y<minY) minY=p.y;
    if(p.x>maxX) maxX=p.x; if(p.y>maxY) maxY=p.y;
  }
  const cw = els.canvas.width, ch = els.canvas.height;
  const x = minX*cw, y=minY*ch, w=(maxX-minX)*cw, h=(maxY-minY)*ch;

  ctx.save();
  ctx.lineWidth = highlight? 3 : 1.5;
  let stroke = 'rgba(255,255,255,0.7)';
  let fill = 'rgba(255,255,255,0.08)';
  if(state==='closed'){
    stroke = 'rgba(255,82,82,0.95)'; // red
    fill = 'rgba(255,82,82,0.15)';
  } else if(state==='open'){
    stroke = 'rgba(0,230,118,0.95)'; // green
    fill = 'rgba(0,230,118,0.12)';
  }
  if(highlight){
    // emphasize highlight by blending with gold
    stroke = 'rgba(255,204,0,0.95)';
  }
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x,y,w,h, 8);
  ctx.fill();
  ctx.stroke();
  // Label
  const label = `face ${index+1}`;
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#111';
  ctx.strokeStyle = stroke;
  const pad=6;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = stroke;
  ctx.fillRect(x, Math.max(0,y-22), tw+pad*2, 20);
  ctx.fillStyle = '#111';
  ctx.fillText(label, x+pad, Math.max(14,y-6));
  ctx.restore();

  return {x,y,w,h};
}

async function initFaceMesh(){
  return new Promise((resolve)=>{
    fm = new FaceMesh({locateFile: (file)=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
    fm.setOptions({
      maxNumFaces: 3,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    fm.onResults(onResults);
    resolve();
  });
}

async function startCamera(){
  if(running) return;

  // Match canvas to displayed size
  const rect = els.video.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  els.canvas.width = w;
  els.canvas.height = h;

  await initFaceMesh();

  // Preload CNN if opted in
  if(els.useCnn?.checked){
    els.msg.textContent = 'Loading eye CNN…';
    await loadEyeModel();
    // Keep toggle state as-is; just inform the user if loading failed.
    els.msg.textContent = eyeModel ? '' : 'Failed to load eye CNN model';
  }

  // Use MediaPipe's Camera helper to send frames to FaceMesh
  camera = new Camera(els.video, {
    onFrame: async () => {
      lastTimestamp = performance.now();
      dbg.framesSent += 1;
      await fm.send({image: els.video});
    },
    width: w,
    height: h,
  });
  await camera.start();
  running = true;
  dbg.started = true; updateDebugOverlay();
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;
  setState('running');
}

function stopCamera(){
  if(!running) return;
  try{ camera.stop(); }catch(_){ }
  running = false;
  dbg.started = false; updateDebugOverlay();
  // Stop siren on close cam
  stopSiren();
  // Clear any stop-gating/banner state
  hideParkBanner();
  clearStopGate();
  // Hide/decay pumpkin immediately
  pumpkinShowing = false;
  setState('stopped');
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
}

function onResults(results){
  // Draw video background
  ctx.save();
  ctx.clearRect(0,0,els.canvas.width, els.canvas.height);
  ctx.drawImage(results.image, 0,0, els.canvas.width, els.canvas.height);
  dbg.results += 1;

  const faces = results.multiFaceLandmarks || [];
  // store latest landmarks for diagnostics
  lastFacesLandmarks = faces;
  updateDebugOverlay(`faces:${faces.length}`);
  // Surface loading states for CNN UI readouts so users don't see stale '-'
  if(els.useCnn?.checked && !eyeModel){
    if(els.cnnL) els.cnnL.textContent = '…';
    if(els.cnnR) els.cnnR.textContent = '…';
  }
  if(els.useMouthCnn?.checked && !mouthModel){
    if(els.mouthPred) els.mouthPred.textContent = 'loading…';
  }
  if(faces.length){
    // Determine target face = closest to canvas center
    const cw = els.canvas.width, ch = els.canvas.height;
    const centerX = 0.5, centerY = 0.5; // normalized
    let targetIdx = 0, bestScore = Infinity;
    const centers = faces.map(lm => {
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for(const p of lm){ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
      const cx = (minX+maxX)/2, cy=(minY+maxY)/2;
      return {cx,cy};
    });
    if(targetIndexUser != null && targetIndexUser < faces.length){
      targetIdx = targetIndexUser;
    } else {
      centers.forEach((c, i)=>{
        const dx=c.cx-centerX, dy=c.cy-centerY;
        const d2 = dx*dx+dy*dy;
        if(d2<bestScore){ bestScore=d2; targetIdx=i; }
      });
    }

    // For each face: compute EAR and CNN closed-prob if enabled. Draw box and markers accordingly.
    const thresh = parseFloat(els.threshold.value);
    const useCnn = !!els.useCnn?.checked;
    const cnnThresh = parseFloat(els.cnnThresh?.value || '0.6');
    const haveModel = !!eyeModel;
    lastFaceBoxes = faces.map((lm, i)=>{
      const leftEAR = earForEye(lm, LEFT_EYE);
      const rightEAR = earForEye(lm, RIGHT_EYE);
      const earAvg = (leftEAR + rightEAR)/2;
      let isClosed = earAvg < thresh;
      let state = isClosed ? 'closed' : 'open';
      let color = isClosed ? 'rgba(255,82,82,0.95)' : 'rgba(0,230,118,0.95)';

      // If CNN is enabled and model is loaded, compute per-eye closed probabilities.
      if(useCnn && haveModel){
        try{
          // Compute eye boxes and crop from the source image (results.image is same as video frame drawn)
          const boxL = landmarksEyeBox(lm, LEFT_EYE);
          const boxR = landmarksEyeBox(lm, RIGHT_EYE);
          const tL = cropEyeToTensor(els.canvas, boxL);
          const tRraw = cropEyeToTensor(els.canvas, boxR);
          const tR = flipTensorLeftRight(tRraw); // flip right eye for consistency
          const batch = tf.stack([tL, tR], 0); // [2, H, W, 1]
          const preds = eyeModel.predict(batch);
          const probs = Array.from(preds.dataSync()); // assuming shape [2,1] or [2]
          tf.dispose([tL, tRraw, tR, batch, preds]);
          const pL = smoothProb('L', probs[0]);
          const pR = smoothProb('R', probs[1] ?? probs[0]);

          // Update UI if this is target face; the next block sets per-target UI anyway, but we display for each just last eval
          if(i===targetIdx){
            if(els.cnnL) els.cnnL.textContent = pL.toFixed(2);
            if(els.cnnR) els.cnnR.textContent = pR.toFixed(2);
          }

          const closedByCnn = ((pL + pR)/2) >= cnnThresh;
          isClosed = closedByCnn; // override EAR with CNN when enabled
          state = isClosed ? 'closed' : 'open';
          color = isClosed ? 'rgba(255,82,82,0.95)' : 'rgba(0,230,118,0.95)';
        }catch(err){
          // If anything fails, fall back to EAR
          console.warn('CNN eye inference failed:', err);
        }
      }
      drawEyeMarkers(lm, LEFT_EYE, color);
      drawEyeMarkers(lm, RIGHT_EYE, color);
      return drawFaceBox(lm, i, i===targetIdx, state);
    });

  // Compute drowsiness for target
    const lm = faces[targetIdx];
    const left = earForEye(lm, LEFT_EYE);
    const right = earForEye(lm, RIGHT_EYE);
    const ear = (left+right)/2;
    els.earL.textContent = left.toFixed(3);
    els.earR.textContent = right.toFixed(3);
    els.targetFace.textContent = `${targetIdx+1} / ${faces.length}`;

  const now = performance.now();
    const dt = lastTimestamp ? (now - lastTimestamp)/1000 : 0; // seconds
    // Decide closed for accumulation based on CNN if enabled and available, else EAR
    let targetClosed = false;
    if(els.useCnn?.checked && eyeModel){
      // Recompute quick CNN probs for the target only to decide accumulation (ensure values exist even if above loop didn't run or target changed)
      try{
        const boxL = landmarksEyeBox(lm, LEFT_EYE);
        const boxR = landmarksEyeBox(lm, RIGHT_EYE);
  const tL = cropEyeToTensor(els.canvas, boxL);
  const tRraw = cropEyeToTensor(els.canvas, boxR);
        const tR = flipTensorLeftRight(tRraw);
        const batch = tf.stack([tL, tR], 0);
        const preds = eyeModel.predict(batch);
        const probs = Array.from(preds.dataSync());
        tf.dispose([tL, tRraw, tR, batch, preds]);
        const pL = smoothProb('L', probs[0]);
        const pR = smoothProb('R', probs[1] ?? probs[0]);
        if(els.cnnL) els.cnnL.textContent = pL.toFixed(2);
        if(els.cnnR) els.cnnR.textContent = pR.toFixed(2);
        const cnnThresh = parseFloat(els.cnnThresh.value);
        targetClosed = ((pL + pR)/2) >= cnnThresh;
      }catch(err){
        console.warn('CNN target inference failed:', err);
        targetClosed = ear < thresh;
      }
    } else {
      targetClosed = ear < thresh;
    }

    if(targetClosed){
      // start the closed timer if not already started
      if(closedStartMs === 0) closedStartMs = now;
      lastEyesClosedAtMs = now; // track last closed time
    } else {
      // reset continuous-closed timer immediately on open to avoid counting blinks
      closedStartMs = 0;
    }
    const closedForDisplaySec = closedStartMs ? ((now - closedStartMs) / 1000.0) : 0.0;
    els.closedTime.textContent = `${closedForDisplaySec.toFixed(2)}s`;

    const need = parseFloat(els.duration.value);
    const wasDrowsy = drowsy;
    drowsy = closedForDisplaySec >= need;
    if(drowsy && !wasDrowsy){
      els.msg.textContent = 'Drowsiness detected!';
      if(!inMiniGame) boo();
    }
    if(!drowsy && wasDrowsy){
      els.msg.textContent = '';
    }

    // Update video-stage visual state
    if(els.videoStage){
      els.videoStage.classList.toggle('danger', drowsy);
      const warning = targetClosed && !drowsy;
      els.videoStage.classList.toggle('warning', warning);
    }

  // Draw pumpkin overlay.
    // When using CNN: do NOT show on quick blinks. Show only after eyes have been
    // closed for at least PUMPKIN_CNN_SHOW_DELAY_SEC. After reopening, keep showing
    // only if it was already visible and we're within hideDelay.
    const hideDelaySec = parseFloat(els.hideDelay.value);
    const sinceClosedSec = (now - lastEyesClosedAtMs)/1000;
  const wasVisible = pumpkinShowing;
  let showPumpkin = false;
    // Universal pumpkin show delay: only show after eyes have been closed for PUMPKIN_SHOW_DELAY_SEC
    if(els.useCnn?.checked){
      if(targetClosed){
        if(closedForDisplaySec >= PUMPKIN_SHOW_DELAY_SEC){
          showPumpkin = true;
          pumpkinShowing = true;
        }
      } else {
        // eyes opened -> keep showing only if within hide delay
        if(pumpkinShowing && sinceClosedSec <= hideDelaySec) showPumpkin = true;
        else pumpkinShowing = false;
      }
    // This is the NEW, correct block
} else {
  // EAR mode: Use the same stateful logic as CNN mode to avoid blink-flashing
  if(targetClosed){
    if(closedForDisplaySec >= PUMPKIN_SHOW_DELAY_SEC){
      showPumpkin = true;
      pumpkinShowing = true; // Set the flag
    }
  } else {
    // eyes opened -> keep showing only if within hide delay
    if(pumpkinShowing && sinceClosedSec <= hideDelaySec) {
        showPumpkin = true; // Keep it on
    }
    else {
        pumpkinShowing = false; // Turn it off for real
    }
  }
}

// ---- Diagnostic: run a single CNN inference (eye + mouth) and report results ----
async function runDiagnostics(){
  const outEl = document.getElementById('diagOutput');
  const parts = [];
  outEl.textContent = 'Starting diagnostic...';
  try{
    // Load models (if not already)
    const [eModel, mModel] = await Promise.all([loadEyeModel().catch(()=>null), loadMouthModel().catch(()=>null)]);
    parts.push(`eyeModel:${eModel? 'ok':'missing'}`);
    parts.push(`mouthModel:${mModel? 'ok':'missing'}`);

    // Prefer to run real inference if we have a recent face and canvas
    if(lastFacesLandmarks && lastFacesLandmarks.length && els.canvas){
      const lm = lastFacesLandmarks[0];
      parts.push('Using live face capture');
      // Eye test
      if(eModel){
        try{
          const boxL = landmarksEyeBox(lm, LEFT_EYE);
          const boxR = landmarksEyeBox(lm, RIGHT_EYE);
          const tL = cropEyeToTensor(els.canvas, boxL);
          const tRraw = cropEyeToTensor(els.canvas, boxR);
          const tR = flipTensorLeftRight(tRraw);
          const batch = tf.stack([tL, tR], 0);
          const preds = eModel.predict(batch);
          const probs = Array.from(preds.dataSync());
          tf.dispose([tL, tRraw, tR, batch, preds]);
          parts.push(`eyeP:[${probs.map(p=>p.toFixed(3)).join(',')}]`);
        }catch(e){ parts.push('eyeInferErr:'+String(e)); }
      }

      // Mouth test
      if(mModel){
        try{
          // approximate mouth box from landmarks
          const top = lm[13], bottom = lm[14];
          const left = lm[61], right = lm[291];
          const cx = (left.x + right.x)/2; const cy = (top.y + bottom.y)/2;
          const w = Math.abs(right.x - left.x) * 1.6; const h = Math.abs(bottom.y - top.y) * 2.2;
          const box = { cx, cy, w, h };
          const t = cropMouthFromCanvas(box, els.canvas);
          const batch = tf.tidy(()=>tf.expandDims(t, 0));
          const preds = mModel.predict(batch);
          const probs = Array.from(preds.dataSync());
          tf.dispose([t, batch, preds]);
          parts.push(`mouthP:[${probs.slice(0,8).map(p=>p.toFixed(3)).join(',')}${probs.length>8? ',...':''}]`);
        }catch(e){ parts.push('mouthInferErr:'+String(e)); }
      }
    } else {
      parts.push('No live face available — running synthetic tensor checks');
      // Synthetic checks: feed zeros of correct shapes to exercise models
      if(eModel){
        try{
          const z = tf.zeros([2, EYE_H, EYE_W, 1]);
          const preds = eModel.predict(z);
          const probs = Array.from(preds.dataSync());
          tf.dispose([z, preds]);
          parts.push(`eyeP_synth:[${probs.map(p=>p.toFixed(3)).join(',')}]`);
        }catch(e){ parts.push('eyeSynthErr:'+String(e)); }
      }
      if(mModel){
        try{
          const z = tf.zeros([1, MOUTH_H, MOUTH_W, 3]);
          const preds = mModel.predict(z);
          const probs = Array.from(preds.dataSync());
          tf.dispose([z, preds]);
          parts.push(`mouthP_synth:[${probs.slice(0,8).map(p=>p.toFixed(3)).join(',')}${probs.length>8? ',...':''}]`);
        }catch(e){ parts.push('mouthSynthErr:'+String(e)); }
      }
    }
    outEl.textContent = parts.join('\n');
  }catch(err){
    outEl.textContent = 'Diagnostic failed: ' + (err?.message || String(err));
  }
}

// Hook up the diagnostic button if present
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('diagBtn');
  if(btn){ btn.addEventListener('click', async (e)=>{ e.preventDefault(); await runDiagnostics(); }); }
});

// Expose the diagnostics function for automated tests / headless runs
try{ window.runDiagnostics = runDiagnostics; }catch(e){ /* ignore if window not available */ }

// Background-preload TF.js models on page load so regular runs are smoother.
document.addEventListener('DOMContentLoaded', ()=>{
  (async ()=>{
    try{
      // Light status update if diagOutput exists
      const out = document.getElementById('diagOutput');
      if(out) out.textContent = 'Preloading CNN models…';
      // Try to load eye and mouth models but don't block page load
      const [e,m] = await Promise.all([loadEyeModel().catch(()=>null), loadMouthModel().catch(()=>null)]);
      if(out){
        const parts = [];
        parts.push(`eye:${e? 'ok' : 'missing'}`);
        parts.push(`mouth:${m? 'ok' : 'missing'}`);
        out.textContent = parts.join('\n');
      }
    }catch(_){ /* ignore */ }
  })();
});

// Provide a globally-accessible, minimal diagnostics function that works even when
// the rest of the app is loaded as an ES module (so tests and headless scripts
// can call it directly). This performs synthetic model loads and inference and
// writes a short status string to `#diagOutput`.
(function(){
  try{
    window.runDiagnosticsMinimal = async function(){
      const outEl = document.getElementById('diagOutput');
      if(outEl) outEl.textContent = 'Running minimal diagnostic...';
      const parts = [];
      try{
        if(!window.tf || typeof window.tf.loadLayersModel !== 'function'){
          parts.push('tfjs:not_found');
          if(outEl) outEl.textContent = parts.join('\n');
          return parts;
        }
        // Try eye model
        try{
          const m = await window.tf.loadLayersModel('/model/eye_state_model/model.json');
          parts.push('eye:loaded');
          try{
            const inShape = (m.inputs && m.inputs[0] && m.inputs[0].shape) || null;
            if(Array.isArray(inShape)){
              const shape = inShape.map(s => (s === null ? 1 : s));
              const t = window.tf.zeros(shape);
              const pred = m.predict(t);
              const vals = await (pred.data ? pred.data() : pred.array());
              parts.push('eyePred:'+Array.from(vals).slice(0,4).map(v=>v.toFixed(4)).join(','));
              if(t.dispose) t.dispose(); if(pred.dispose) pred.dispose();
            } else { parts.push('eye:no_input_shape'); }
          }catch(e){ parts.push('eyePredErr:'+String(e)); }
        }catch(e){ parts.push('eyeLoadErr:'+String(e.message||e)); }

        // Try mouth model
        try{
          const m2 = await window.tf.loadLayersModel('/model/mouth_classifier_model/model.json');
          parts.push('mouth:loaded');
          try{
            const inShape = (m2.inputs && m2.inputs[0] && m2.inputs[0].shape) || null;
            if(Array.isArray(inShape)){
              const shape = inShape.map(s => (s === null ? 1 : s));
              const t2 = window.tf.zeros(shape);
              const pred2 = m2.predict(t2);
              const vals2 = await (pred2.data ? pred2.data() : pred2.array());
              parts.push('mouthTop:'+ (Array.isArray(vals2) ? vals2.map(v=>v.toFixed(4)).slice(0,8).join(',') : String(vals2)));
              if(t2.dispose) t2.dispose(); if(pred2.dispose) pred2.dispose();
            } else { parts.push('mouth:no_input_shape'); }
          }catch(e){ parts.push('mouthPredErr:'+String(e)); }
        }catch(e){ parts.push('mouthLoadErr:'+String(e.message||e)); }

      }catch(e){ parts.push('diagErr:'+String(e)); }
      if(outEl) outEl.textContent = parts.join('\n');
      return parts;
    };
  }catch(_){ }
})();
    // Update pumpkin fade (decay on hide)
    const dtSec = dt;
    if(showPumpkin){
      pumpkinFade = Math.min(1, pumpkinFade + (dtSec / Math.max(0.001, PUMPKIN_FADE_IN_SEC)));
    } else {
      pumpkinFade = Math.max(0, pumpkinFade - (dtSec / Math.max(0.001, PUMPKIN_FADE_OUT_SEC)));
    }
    if(pumpkinFade > 0 && !inMiniGame){
      drawPumpkinOverFace(lm, pumpkinFade);
    }

        // If pumpkin just became visible this frame, increment counter
    if(!inMiniGame && !wasVisible && pumpkinShowing){
          drowsyCount += 1;
          if(els.drowsyCount) els.drowsyCount.textContent = String(drowsyCount);
        }

    // Trigger mini-game if over threshold, but gate by vehicle stop
    if(!inMiniGame && drowsyCount > 5){
      if(!awaitingStop){
        awaitingStop = true;
        showParkBanner('Please park on the side and take the test.');
        // Wait for stop; allow manual proceed via banner button
        waitForVehicleStop({ speed: 1.5, holdSeconds: 5, timeoutMs: 60000 })
          .then(()=>{
            hideParkBanner();
            enterMiniGame();
          })
          .catch(()=>{
            // Keep banner visible; user can proceed manually when safe
          });
      }
    }

    // Head tilt detection and skeleton hand trigger for target (with hold while eyes closed)
    const leftCheek = lm[234];
    const rightCheek = lm[454];
    if(leftCheek && rightCheek){
      const angle = Math.atan2(rightCheek.y - leftCheek.y, rightCheek.x - leftCheek.x);
      let side = null;
      if(angle > TILT_THRESHOLD_RAD) side = 'right';
      else if(angle < -TILT_THRESHOLD_RAD) side = 'left';
      const nowMs = now;
      if(side && targetClosed){
        if(tiltHoldSide !== side){ tiltHoldSide = side; tiltHoldStartMs = nowMs; }
        const held = nowMs - (tiltHoldStartMs || nowMs);
        if(!handAnim && held >= TILT_HOLD_MS && (nowMs - lastHandTriggerMs) > TILT_COOLDOWN_MS){
          handAnim = { side, startMs: nowMs };
          lastHandTriggerMs = nowMs;
          tiltHoldStartMs = 0; tiltHoldSide = null; // reset for next time
        }
      } else {
        // reset hold if not tilted or eyes open
        tiltHoldStartMs = 0; tiltHoldSide = null;
      }
    }

    // Draw skeleton hand animation on top
    const bbox = lastFaceBoxes && lastFaceBoxes[targetIdx];
    updateAndDrawHand(now, bbox);

    // Mouth classification (optional) -> trigger eyePop on yawn
    const yawnCooldownMs = parseFloat(els.yawnCooldown.value) * 1000;
    const yawnMinDurMs = (parseFloat(els.yawnMinDur?.value || '0.5')) * 1000;
    const morGate = parseFloat(els.yawnMorMin?.value || '0.35');
    let mouthClass = null;
  if(els.useMouthCnn?.checked && mouthModel){
      try{
        // approximate mouth box from landmarks
        const top = lm[13], bottom = lm[14];
        const left = lm[61], right = lm[291];
        const cx = (left.x + right.x)/2; const cy = (top.y + bottom.y)/2;
        const w = Math.abs(right.x - left.x) * 1.6; const h = Math.abs(bottom.y - top.y) * 2.2;
        const box = { cx, cy, w, h };
        const t = cropMouthFromCanvas(box, els.canvas);
        const batch = tf.tidy(()=>tf.expandDims(t, 0));
        const preds = mouthModel.predict(batch);
        const probs = Array.from(preds.dataSync());
        tf.dispose([t, batch, preds]);

        // Binary yawn model handling (preferred)
        if(mouthModel._yawnBinary || probs.length <= 2){
          // If softmax of 2, assume index 1 corresponds to 'yawn'
          const rawYawnProb = (probs.length === 1) ? probs[0] : (probs[1] ?? 0);
          const yawnProb = smoothMouthScalar(rawYawnProb);
          const thr = parseFloat(els.yawnThresh.value);
          const mor = mouthOpenRatio(lm);
          const gatingOk = (yawnProb >= thr) && (mor >= morGate);
          mouthClass = gatingOk ? 'yawn' : 'no-yawn';
          if(els.mouthPred) els.mouthPred.textContent = `${mouthClass} (p=${yawnProb.toFixed(2)}, mor=${mor.toFixed(2)})`;
          if(gatingOk){
            if(yawnHoldStartMs === 0) yawnHoldStartMs = now;
            const heldMs = now - yawnHoldStartMs;
            if(heldMs >= yawnMinDurMs && !eyePopAnim && now - lastYawnMs > yawnCooldownMs){
              const mc = mouthCenterCanvas(lm);
              eyePopAnim = { startMs: now, x: mc?.cx, y: mc?.cy };
              lastYawnMs = now;
              yawnHoldStartMs = 0;
            }
          } else {
            yawnHoldStartMs = 0;
          }
        } else {
          // Multi-class fallback: ['neutral','open','smile','yawn']
          const smooth = smoothMouthPred(probs);
          const classes = ['neutral','open','smile','yawn'];
          const yawnProb = smooth[3] ?? 0;
          const thr = parseFloat(els.yawnThresh.value);
          const mor = mouthOpenRatio(lm);
          const gatingOk = (yawnProb >= thr) && (mor >= morGate);
          let idx = 0; for(let i=1;i<smooth.length;i++) if(smooth[i] > smooth[idx]) idx = i;
          mouthClass = gatingOk ? 'yawn' : (classes[idx] ?? 'neutral');
          if(els.mouthPred) els.mouthPred.textContent = `${mouthClass} (p=${yawnProb.toFixed(2)}, mor=${mor.toFixed(2)})`;
          if(gatingOk){
            if(yawnHoldStartMs === 0) yawnHoldStartMs = now;
            const heldMs = now - yawnHoldStartMs;
            if(heldMs >= yawnMinDurMs && !eyePopAnim && now - lastYawnMs > yawnCooldownMs){
              const mc = mouthCenterCanvas(lm);
              eyePopAnim = { startMs: now, x: mc?.cx, y: mc?.cy };
              lastYawnMs = now;
              yawnHoldStartMs = 0;
            }
          } else {
            yawnHoldStartMs = 0;
          }
        }
      }catch(err){
        console.warn('Mouth inference error:', err);
      }

      // Draw eye pop animation (if active) during classifier mode as well
      if(eyePopAnim){
        const mcNow = mouthCenterCanvas(lm);
        const px = mcNow?.cx ?? eyePopAnim.x ?? (bbox ? (bbox.x + bbox.w*0.5) : els.canvas.width*0.5);
        const py = mcNow?.cy ?? eyePopAnim.y ?? (bbox ? (bbox.y + bbox.h*0.6) : els.canvas.height*0.6);
        // use a proxy amplitude: if yawnProb was computed, scale by thresholded value; otherwise a fixed medium
        const amp = 0.8; // simple constant; visual only
        drawEyePop(now, px, py, bbox, amp);
      }
    } else {
      // fallback to simple mouth-open ratio (also update mouthPred text)
      const mor = mouthOpenRatio(lm);
      const yawnThresh = parseFloat(els.yawnThresh.value);
      const mouthState = (mor > yawnThresh) ? 'yawn' : (mor > 0.25 ? 'open' : 'neutral');
      if(els.mouthPred) els.mouthPred.textContent = `${mouthState} (mor=${mor.toFixed(2)})`;
      if(mor > yawnThresh){
        if(!eyePopAnim && now - lastYawnMs > yawnCooldownMs){
          const mc = mouthCenterCanvas(lm);
          eyePopAnim = { startMs: now, x: mc?.cx, y: mc?.cy };
          lastYawnMs = now;
        }
      }
      if(eyePopAnim){
        const mcNow = mouthCenterCanvas(lm);
        const px = mcNow?.cx ?? eyePopAnim.x ?? (bbox ? (bbox.x + bbox.w*0.5) : els.canvas.width*0.5);
        const py = mcNow?.cy ?? eyePopAnim.y ?? (bbox ? (bbox.y + bbox.h*0.6) : els.canvas.height*0.6);
        drawEyePop(now, px, py, bbox, mor);
      }
    }
  } else {
    els.earL.textContent = '-';
    els.earR.textContent = '-';
    if(els.cnnL) els.cnnL.textContent = '-';
    if(els.cnnR) els.cnnR.textContent = '-';
    els.targetFace.textContent = '-';
  // reset continuous-closed timer when no faces
  closedAccum = Math.max(0, closedAccum - 0.05);
  closedStartMs = 0;
    els.closedTime.textContent = `${closedAccum.toFixed(2)}s`;
    pumpkinShowing = false; // reset overlay when no faces
    pumpkinFade = 0;
    lastEyesClosedAtMs = 0;
    // no palm indicator
  }

  ctx.restore();
}

// UI wiring
els.threshold.addEventListener('input', ()=>{
  els.thresholdVal.textContent = parseFloat(els.threshold.value).toFixed(2);
});
els.cnnThresh?.addEventListener('input', ()=>{
  els.cnnThreshVal.textContent = parseFloat(els.cnnThresh.value).toFixed(2);
});
els.cnnPumpkinDelay?.addEventListener('input', ()=>{
  const v = parseFloat(els.cnnPumpkinDelay.value);
  // keep legacy variable in sync but use universal delay by default
  PUMPKIN_CNN_SHOW_DELAY_SEC = v;
  if(els.cnnPumpkinDelayVal) els.cnnPumpkinDelayVal.textContent = v.toFixed(1);
});

els.pumpkinDelay?.addEventListener('input', ()=>{
  const v = parseFloat(els.pumpkinDelay.value);
  PUMPKIN_SHOW_DELAY_SEC = v;
  if(els.pumpkinDelayVal) els.pumpkinDelayVal.textContent = v.toFixed(2);
});
els.duration.addEventListener('input', ()=>{
  els.durationVal.textContent = parseFloat(els.duration.value).toFixed(1);
});
els.hideDelay.addEventListener('input', ()=>{
  els.hideDelayVal.textContent = parseFloat(els.hideDelay.value).toFixed(2);
});
els.tiltThresh.addEventListener('input', ()=>{
  const deg = parseFloat(els.tiltThresh.value);
  els.tiltThreshVal.textContent = deg.toFixed(0);
  TILT_THRESHOLD_RAD = deg * Math.PI / 180;
});
els.tiltCooldown.addEventListener('input', ()=>{
  const sec = parseFloat(els.tiltCooldown.value);
  els.tiltCooldownVal.textContent = sec.toFixed(1);
  TILT_COOLDOWN_MS = sec * 1000;
});
els.yawnThresh.addEventListener('input', ()=>{
  const v = parseFloat(els.yawnThresh.value);
  els.yawnThreshVal.textContent = v.toFixed(2);
});
els.yawnCooldown.addEventListener('input', ()=>{
  const v = parseFloat(els.yawnCooldown.value);
  els.yawnCooldownVal.textContent = v.toFixed(1);
});
els.yawnMorMin?.addEventListener('input', ()=>{
  const v = parseFloat(els.yawnMorMin.value);
  els.yawnMorMinVal.textContent = v.toFixed(2);
});
els.yawnMinDur?.addEventListener('input', ()=>{
  const v = parseFloat(els.yawnMinDur.value);
  els.yawnMinDurVal.textContent = v.toFixed(1);
});
els.startBtn.addEventListener('click', startCamera);
els.stopBtn.addEventListener('click', stopCamera);

// Load model when toggled or on start if checkbox is pre-checked
els.useCnn?.addEventListener('change', async ()=>{
  if(els.useCnn.checked && !eyeModel){
    els.msg.textContent = 'Loading eye CNN…';
    await loadEyeModel();
    // Keep toggle state as-is; just inform the user if loading failed.
    els.msg.textContent = eyeModel ? '' : 'Failed to load eye CNN model';
  }
  // Reset accumulation and overlay state when switching mode
  closedAccum = 0;
  closedStartMs = 0;
  drowsy = false;
  lastEyesClosedAtMs = 0;
  pumpkinShowing = false;
  pumpkinFade = 0;
  els.closedTime.textContent = `${closedAccum.toFixed(2)}s`;
});

els.useMouthCnn?.addEventListener('change', async ()=>{
  if(els.useMouthCnn.checked && !mouthModel){
    els.msg.textContent = 'Loading mouth model…';
    await loadMouthModel();
    els.msg.textContent = '';
  }
  // reset mouth prediction history
  mouthHist = [];
  mouthHistVec = [];
  mouthHistScalar = [];
  if(els.mouthPred) els.mouthPred.textContent = '-';
});

// Handle page visibility to stop cam
window.addEventListener('visibilitychange', ()=>{ if(document.hidden) stopCamera(); });

// Helpful instruction for permissions
window.addEventListener('load', ()=>{
  els.msg.textContent = 'Click Start Camera and grant camera access.';
});

// Overlay buttons
els.mgStartBtn?.addEventListener('click', (e)=>{ e.preventDefault(); startSimon(); });
els.mgExitBtn?.addEventListener('click', (e)=>{ e.preventDefault(); cleanupMiniGame(); inMiniGame = false; });
// Park banner proceed button
els.parkProceedBtn?.addEventListener('click', (e)=>{
  e.preventDefault();
  hideParkBanner();
  clearStopGate();
  if(!inMiniGame){ enterMiniGame(); }
});

// Select target face by clicking on a box
els.canvas.addEventListener('click', (e)=>{
  if(!lastFaceBoxes.length) return;
  const rect = els.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  for(let i=0;i<lastFaceBoxes.length;i++){
    const b = lastFaceBoxes[i];
    if(!b) continue;
    if(x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h){
  targetIndexUser = i;
  closedAccum = 0; // legacy reset
  closedStartMs = 0; // reset continuous-close timer when switching
      drowsy = false;
      els.msg.textContent = '';
      lastEyesClosedAtMs = 0;
      pumpkinShowing = false;
      pumpkinFade = 0;
      break;
    }
  }
});

// Keyboard navigation to cycle faces
window.addEventListener('keydown', async (e)=>{
  const facesCount = lastFaceBoxes.length;
  if(!facesCount) return;
  // Dataset capture mode: n/o/s/y to download current mouth crop
  if(els.captureMode?.checked && !e.repeat){
    const key = e.key.toLowerCase();
    const labelMap = { n: 'neutral', o: 'open', s: 'smile', y: 'yawn' };
    if(labelMap[key]){
      e.preventDefault();
      const targetIdx = targetIndexUser ?? 0;
      const bbox = lastFaceBoxes[targetIdx];
      if(bbox){
        try{
          // approximate mouth box using face bbox proportion
          const cx = (bbox.x + bbox.w*0.5) / els.canvas.width;
          const cy = (bbox.y + bbox.h*0.62) / els.canvas.height;
          const box = { cx, cy, w: (bbox.w/els.canvas.width)*0.5, h: (bbox.h/els.canvas.height)*0.32 };
          const t = cropMouthFromCanvas(box, els.canvas);
          const off = document.createElement('canvas');
          off.width = MOUTH_W; off.height = MOUTH_H;
          await tf.browser.toPixels(t, off);
          t.dispose();
          off.toBlob((blob)=>{
            if(!blob) return;
            const a = document.createElement('a');
            const ts = Date.now();
            const url = URL.createObjectURL(blob);
            a.href = url;
            a.download = `${labelMap[key]}_${ts}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(()=>URL.revokeObjectURL(url), 1500);
          }, 'image/png');
        }catch(err){ console.warn('Capture failed:', err); }
      }
    }
  }
  if(e.key === 'ArrowRight'){
    if(targetIndexUser == null) targetIndexUser = 0; else targetIndexUser = (targetIndexUser+1) % facesCount;
    closedAccum = 0; closedStartMs = 0; drowsy=false; els.msg.textContent=''; lastEyesClosedAtMs = 0; pumpkinShowing = false;
  } else if(e.key === 'ArrowLeft'){
    if(targetIndexUser == null) targetIndexUser = 0; else targetIndexUser = (targetIndexUser-1+facesCount) % facesCount;
    closedAccum = 0; closedStartMs = 0; drowsy=false; els.msg.textContent=''; lastEyesClosedAtMs = 0; pumpkinShowing = false;
  }
});

// ===================== Sleep Predictor (synthetic) =====================
class SleepPredictor{
  constructor(){
    this.setPersona('normal');
    this.coeff = {
      // Tuned to raise pre-dawn (3–6 AM) risk and weigh hoursAwake/sleepDebt more
      intercept: -2.2,
      screen15: 0.015,
      screen30: 0.010,
      screen60: 0.008,
      session: 0.02,
      unlocks60: 0.02,
      video60: 0.012,
      social60: 0.01,
      games60: 0.008,
      hoursAwake: 0.20,
      sleepDebt: 0.40,
      tod_sin: 0.22,
      tod_cos: 1.00,
      preBedH: 0.20,
      pastBedH: 0.90,
      earlyNightBump: 0.55,
      preDawn: 0.85, // additional triangle bump centered ~5 AM
      weekend: 0.15,
    };
    this.mode = 'demo';
    this.startMs = Date.now();
    this.startMin = this._minutesOfDay(new Date());
    this.pastBedCapH = 6; // hours cap for _hoursPastHabitualBed
    this.resetState();
  }
  _minutesOfDay(d){ return d.getHours()*60 + d.getMinutes(); }
  setPersona(kind){
    const p = {
      early:  { bedtime: 22*60+30, wake: 6*60+30 },
      normal: { bedtime: 23*60+30, wake: 7*60+30 },
      owl:    { bedtime: 24*60+30, wake: 8*60+30 },
    }[kind] || { bedtime: 23*60+30, wake: 7*60+30 };
    this.persona = kind;
    this.habitualBed = p.bettime ?? p.bedtime; // tolerate typo
    this.habitualWake = p.wake;
  }
  setMode(mode){
    this.mode = (mode === 'real') ? 'real' : 'demo';
    this.startMs = Date.now();
    this.startMin = this._minutesOfDay(new Date());
  }
  resetState(){
    this.nowMin = this._minutesOfDay(new Date());
    this.sleepDebtH = 1.5; // hours
    this.features = { screen15:0, screen30:0, screen60:0, session:0, unlocks60:0, video60:0, social60:0, games60:0 };
  }
  stepSim(){
    if(this.mode === 'real') this.nowMin = this._minutesOfDay(new Date());
    else {
      const elapsedMs = Date.now() - this.startMs;
      const simMinutes = Math.floor(elapsedMs / 1000); // 1 sec = 1 min
      this.nowMin = (this.startMin + simMinutes) % (24*60);
    }
    const h = Math.floor(this.nowMin/60);
    const on = Math.random() < this._screenProb(h);
    const mix = this._appMix(h);
    // simple decays
    this.features.screen15 = Math.max(0, this.features.screen15 + (on?1:0) - this.features.screen15/15);
    this.features.screen30 = Math.max(0, this.features.screen30 + (on?1:0) - this.features.screen30/30);
    this.features.screen60 = Math.max(0, this.features.screen60 + (on?1:0) - this.features.screen60/60);
    this.features.session = on ? (this.features.session + 1) : 0;
    const unlocked = (!on && Math.random()<0.05) || (on && this.features.session===1);
    this.features.unlocks60 = Math.max(0, this.features.unlocks60 + (unlocked?1:0) - this.features.unlocks60/60);
    this.features.video60  = Math.max(0, this.features.video60  + (on?mix.video:0)  - this.features.video60/60);
    this.features.social60 = Math.max(0, this.features.social60 + (on?mix.social:0) - this.features.social60/60);
    this.features.games60  = Math.max(0, this.features.games60  + (on?mix.games:0)  - this.features.games60/60);
  }
  _screenProb(hour){ if(hour<6) return 0.03; if(hour<12) return 0.15; if(hour<17) return 0.18; if(hour<21) return 0.24; return 0.32; }
  _appMix(hour){ if(hour>=21||hour<1) return {video:0.6,social:0.25,games:0.15}; if(hour>=17) return {video:0.45,social:0.35,games:0.2}; if(hour>=12) return {video:0.3,social:0.5,games:0.2}; return {video:0.2,social:0.6,games:0.2}; }
  _circadian(tod){ const ang=2*Math.PI*tod; return { sin:Math.sin(ang), cos:Math.cos(ang) }; }
  _hoursSinceWake(){ const diff=(this.nowMin - this.habitualWake + 1440)%1440; return diff/60; }
  _hoursToHabitualBed(){ const d=(this.habitualBed - this.nowMin + 1440)%1440; return d/60; }
  // Count up to configured hours past habitual bedtime to capture pre-dawn fatigue
  _hoursPastHabitualBed(){ const d=(this.nowMin - this.habitualBed + 1440)%1440; const cap=(this.pastBedCapH||6)*60; return d<=cap? d/60 : 0; }
  applyPreset(name){
    if(name==='classic'){
      this.coeff = {
        intercept: -2.6,
        screen15: 0.015,
        screen30: 0.010,
        screen60: 0.008,
        session: 0.02,
        unlocks60: 0.02,
        video60: 0.012,
        social60: 0.01,
        games60: 0.008,
        hoursAwake: 0.15,
        sleepDebt: 0.30,
        tod_sin: 0.25,
        tod_cos: 0.80,
        preBedH: 0.25,
        pastBedH: 0.70,
        earlyNightBump: 0.50,
        preDawn: 0.0,
        weekend: 0.15,
      };
      this.pastBedCapH = 4;
    } else {
      // tuned (default)
      this.coeff = {
        intercept: -2.2,
        screen15: 0.015,
        screen30: 0.010,
        screen60: 0.008,
        session: 0.02,
        unlocks60: 0.02,
        video60: 0.012,
        social60: 0.01,
        games60: 0.008,
        hoursAwake: 0.20,
        sleepDebt: 0.40,
        tod_sin: 0.22,
        tod_cos: 1.00,
        preBedH: 0.20,
        pastBedH: 0.90,
        earlyNightBump: 0.55,
        preDawn: 0.85,
        weekend: 0.15,
      };
      this.pastBedCapH = 6;
    }
  }
  predict(){
    const { screen15,screen30,screen60,session,unlocks60,video60,social60,games60 } = this.features;
    const tod = this.nowMin/1440; const {sin,cos} = this._circadian(tod);
    const hoursAwake = this._hoursSinceWake();
    const sleepDebt = this.sleepDebtH;
    const hoursToBed = this._hoursToHabitualBed();
    const preBedH = Math.max(0, Math.min(2, hoursToBed));
    const pastBedH = this._hoursPastHabitualBed();
    const w = this.coeff;
    let personaBump = 0; if(this.persona==='early'){ const h=Math.floor(this.nowMin/60); if(h>=22||h<2) personaBump=w.earlyNightBump; }
    // Pre-dawn triangular bump: 0 at 3:00/6:00, peaks near 5:00
    const hour = this.nowMin/60;
    let preDawnBump = 0;
    if(hour>=3 && hour<6){ const center=5; const span=1.5; const dist=Math.abs(hour-center); preDawnBump = Math.max(0, 1 - dist/span); }
    const z = w.intercept
      + w.screen15*screen15 + w.screen30*screen30 + w.screen60*screen60
      + w.session*session + w.unlocks60*unlocks60
      + w.video60*video60 + w.social60*social60 + w.games60*games60
      + w.hoursAwake*hoursAwake + w.sleepDebt*sleepDebt
      + w.tod_sin*sin + w.tod_cos*cos
      + w.weekend*0
      + w.preBedH*preBedH + w.pastBedH*pastBedH
      + personaBump + w.preDawn*preDawnBump;
    const risk = 1/(1+Math.exp(-z));
    const pull = Math.min(90, (risk*60) + sleepDebt*10);
    const etaMin = (this.habitualBed - pull + 1440) % 1440;
    return { risk, etaMin, factors: this._factors(risk, hoursAwake) };
  }
  _factors(risk, hoursAwake){
    const f=[]; if(this.features.screen60>30) f.push({t:'High screen (60m)',s:'warn'});
    if(this.features.session>25) f.push({t:'Long session',s:'warn'});
    if(this.features.video60>25) f.push({t:'Video binge',s:'warn'});
    if(this.sleepDebtH>1.0) f.push({t:'Sleep debt',s: risk>0.6?'danger':'warn'});
    if(hoursAwake>15) f.push({t:'Long day',s:'danger'});
    if(!f.length) f.push({t:'Stable pattern',s:''});
    return f;
  }
}

let sleepPred = null;
let sleepSimTimer = null;
function minsToClock(mins){ const mm=Math.round(mins); const h=Math.floor(mm/60)%24; const m=mm%60; const hh=((h+11)%12)+1; const ampm=h<12?'AM':'PM'; return `${String(hh).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`; }
function updateSleepUI(risk, etaMin, factors){
  if(els.sleepRisk) els.sleepRisk.textContent = `${Math.round(risk*100)}%`;
  if(els.sleepRiskBar) els.sleepRiskBar.style.width = `${Math.round(risk*100)}%`;
  if(els.sleepEta) els.sleepEta.textContent = minsToClock(etaMin);
  if(els.sleepFactors){ els.sleepFactors.innerHTML=''; for(const f of factors){ const div=document.createElement('div'); div.className=`chip ${f.s||''}`; div.textContent=f.t; els.sleepFactors.appendChild(div);} }
}
function startSleepPredictor(){
  if(!sleepPred) sleepPred = new SleepPredictor();
  const persona = els.sleepPersona?.value || 'normal';
  sleepPred.setPersona(persona);
  // Apply preset and persist
  const preset = els.sleepPreset?.value || window.localStorage.getItem('sleepPreset') || 'tuned';
  sleepPred.applyPreset(preset);
  try{ window.localStorage.setItem('sleepPreset', preset); }catch{}
  const speed = els.sleepSpeed?.value || 'demo';
  const interval = speed==='real' ? 60000 : 1000;
  sleepPred.setMode(speed);
  sleepPred.resetState();
  if(sleepSimTimer) clearInterval(sleepSimTimer);
  if(els.sleepStartBtn) els.sleepStartBtn.disabled = true;
  if(els.sleepStopBtn) els.sleepStopBtn.disabled = false;
  sleepSimTimer = setInterval(()=>{ sleepPred.stepSim(); const {risk,etaMin,factors} = sleepPred.predict(); updateSleepUI(risk, Math.round(etaMin), factors); }, interval);
  // immediate update
  sleepPred.stepSim(); { const {risk,etaMin,factors} = sleepPred.predict(); updateSleepUI(risk, Math.round(etaMin), factors); }
}
function stopSleepPredictor(){ if(sleepSimTimer){ clearInterval(sleepSimTimer); sleepSimTimer=null; } if(els.sleepStartBtn) els.sleepStartBtn.disabled=false; if(els.sleepStopBtn) els.sleepStopBtn.disabled=true; }

els.sleepStartBtn?.addEventListener('click', (e)=>{ e.preventDefault(); startSleepPredictor(); });
els.sleepStopBtn?.addEventListener('click', (e)=>{ e.preventDefault(); stopSleepPredictor(); });
els.sleepPreset?.addEventListener('change', ()=>{ try{ window.localStorage.setItem('sleepPreset', els.sleepPreset.value); }catch{} if(sleepPred){ sleepPred.applyPreset(els.sleepPreset.value); }});
els.sleepJumpBtn?.addEventListener('click', (e)=>{
  e.preventDefault();
  if(!els.sleepJumpTime || !sleepPred) return;
  if(sleepPred.mode !== 'demo'){ alert('Jump works in Demo mode only'); return; }
  const val = els.sleepJumpTime.value || '05:00';
  const [hh,mm] = val.split(':').map(Number);
  const minutes = ((hh%24)*60 + (mm%60));
  // Anchor sim to this time
  sleepPred.startMin = minutes;
  sleepPred.startMs = Date.now();
  sleepPred.nowMin = minutes;
  const {risk,etaMin,factors} = sleepPred.predict();
  updateSleepUI(risk, Math.round(etaMin), factors);
});

// ===================== Test Alert (simulated) =====================
async function sendTestAlert(){
  if(els.alertStatus) els.alertStatus.textContent = 'Sending…';
  // Try to get a quick position; if not available, simulate
  const getPos = ()=> new Promise((resolve)=>{
    if(!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p)=>resolve(p),
      ()=>resolve(null),
      { enableHighAccuracy:true, maximumAge:5000, timeout:3000 }
    );
  });
  const pos = await getPos();
  const now = Date.now();
  // Reuse alert sender if available; else build a simple POST
  const payload = {
    userName: 'Driver',
    incidentId: `test_${now}`,
    lat: pos?.coords?.latitude ?? 0,
    lon: pos?.coords?.longitude ?? 0,
    accuracy: pos?.coords?.accuracy ?? 9999,
    speedMps: pos?.coords?.speed ?? null,
    when: now,
    reason: 'Manual test alert (simulated OK if server absent)'
  };
  try{
    const res = await fetch('http://localhost:8787/api/alert', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(()=>({ok:true}));
    if(els.alertStatus) els.alertStatus.textContent = `Alert sent${data?.ok?' ✓':''}`;
  }catch(_e){
    // Simulated success
    if(els.alertStatus) els.alertStatus.textContent = 'Server unavailable — simulated alert ✓';
  }
}
els.alertTestBtn?.addEventListener('click', (e)=>{ e.preventDefault(); sendTestAlert(); });
