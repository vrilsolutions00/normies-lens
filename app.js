// An Insight for Renee — a peek at what I saw
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

THREE.ColorManagement.enabled = false;
const MP_VER = '0.10.14';
const FACE_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const $ = s => document.querySelector(s);
const canvas = $('#gl'), video = $('#video');
const S = {
  mode: 0, prevMode: 0, modeMix: 1, facing: 'user', mirror: true, watermark: false,
  hasCam: 0, stream: null, recording: false, rec: null, recChunks: [], recStart: 0,
  W: innerWidth, H: innerHeight, aspect: innerWidth / innerHeight,
};
window.__lens = S; // for debugging/tests

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
renderer.setClearColor(0x1e1530, 1);

// ---------- camera texture ----------
const camTex = new THREE.VideoTexture(video);
camTex.minFilter = THREE.LinearFilter; camTex.magFilter = THREE.LinearFilter;
camTex.generateMipmaps = false;
const blankTex = new THREE.DataTexture(new Uint8Array([90, 75, 115, 255]), 1, 1); blankTex.needsUpdate = true;

// ---------- background (mirror room / kaleidoscope / sacred) ----------
const bgUniforms = {
  uCam: { value: blankTex }, uScale: { value: new THREE.Vector2(1, 1) }, uMirror: { value: 1 },
  uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uMode: { value: 0 }, uPrev: { value: 0 },
  uMix: { value: 1 }, uPar: { value: new THREE.Vector2() }, uFace: { value: new THREE.Vector3(0.5, 0.55, 0) }, uMotion: { value: 0 }, uHasCam: { value: 0 },
};
const bgMat = new THREE.ShaderMaterial({
  uniforms: bgUniforms, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D uCam; uniform vec2 uScale; uniform float uMirror; uniform vec2 uRes; uniform float uTime;
uniform vec2 uPar; uniform float uMode; uniform float uPrev; uniform float uMix; uniform vec3 uFace; uniform float uMotion; uniform float uHasCam;
varying vec2 vUv;
#define PI 3.14159265
vec3 pal(float h){ return 0.80 + 0.20*cos(6.2831853*(h + vec3(0.0, 0.33, 0.67))); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 fold(vec2 v){ return 1.0 - abs(1.0 - mod(v, 2.0)); }
vec2 camUV(vec2 s){ vec2 v = (s - 0.5) * uScale + 0.5; if (uMirror > 0.5) v.x = 1.0 - v.x; return v; }
vec3 cam(vec2 s){ return mix(vec3(0.33, 0.27, 0.45), texture2D(uCam, fold(camUV(s))).rgb, uHasCam); }
vec3 grade(vec3 c){
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 plum = vec3(0.16, 0.10, 0.26), lav = vec3(0.64, 0.56, 0.90), blush = vec3(0.98, 0.78, 0.86), cream = vec3(1.0, 0.94, 0.86);
  vec3 g = l < 0.35 ? mix(plum, lav, l / 0.35) : (l < 0.7 ? mix(lav, blush, (l - 0.35) / 0.35) : mix(blush, cream, (l - 0.7) / 0.3));
  return mix(g, c, 0.5) * 0.95;
}
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
// soft, mask-only reflection of the person (no edges, no frames)
vec3 ghost(vec2 s, vec2 fc, vec2 offset, float sc, float flip, out float m){
  float asp = uRes.x / uRes.y;
  vec2 l = (s - fc - offset) / sc;
  if (flip > 0.5) l.x = -l.x;
  vec2 q = l * vec2(asp, 1.0);
  m = 1.0 - smoothstep(0.06, 0.36, length(q * vec2(1.0, 0.72)));
  return grade(cam(fc + l));
}
void main(){
  vec2 s = vUv;
  float asp = uRes.x / uRes.y;
  // flat deep plum void (no haze, no glow, no blur layers)
  vec3 col = vec3(0.075, 0.045, 0.125);
  // the person, composited into the gem space with a narrow edge feather only
  vec2 fc = uFace.z > 0.5 ? uFace.xy + vec2(0.0, -0.12) : vec2(0.5, 0.45);
  vec3 me = grade(cam(s));
  float e = length((s - fc) * vec2(asp, 1.0) * vec2(1.0, 0.68));
  float mm = 1.0 - smoothstep(0.31, 0.37, e);
  col = mix(col, me, mm * uHasCam);
  gl_FragColor = vec4(col, 1.0);
}`,
});
const bgScene = new THREE.Scene();
const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

// ---------- 3D crystal field ----------
const scene = new THREE.Scene();
const FOV = 50, CAMZ = 10, TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const cam3 = new THREE.PerspectiveCamera(FOV, S.aspect, 0.1, 200);
cam3.position.set(0, 0, CAMZ);

// Static, perfectly aligned 3D grid of tiny square-cut pastel gems (rendered as points).
// Scene scale: 1 unit = 6 inches; grid spacing 2 units = 1 ft. Gems are pinpoints: ~2-3 px up close, sub-pixel sparkle points far away.
const GRID = 2.0, DEPTH = 90;   // 2 units = 1 ft spacing
const crystalUniforms = { uDpr: { value: 1 }, uFogNear: { value: 24.0 }, uFogFar: { value: DEPTH }, uView: { value: new THREE.Vector2(0, 0) },
  uLightDir: { value: new THREE.Vector3(-0.35, 0.65, 0.7).normalize() }, uLightCol: { value: new THREE.Vector3(1, 0.97, 0.93) }, uLightI: { value: 1.0 }, uTime: { value: 0 } };
const crystalMat = new THREE.ShaderMaterial({
  uniforms: crystalUniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
attribute vec4 aSeed; attribute float aBig;
uniform float uDpr, uFogNear, uFogFar; uniform vec2 uView; uniform vec3 uLightDir, uLightCol; uniform float uLightI; uniform float uTime;
varying vec3 vCol; varying float vAlpha; varying float vGlint;
vec3 rainbow(float h){ return 0.5 + 0.5 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67))); }
void main(){
  // Gem positions never move. Only the light response changes with the viewing angle (uView).
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  vec3 eye = cameraPosition + vec3(uView * 2.5, 0.0);          // real parallax camera + extra angle for glints
  vec3 V = normalize(eye - position);
  vec3 L = normalize(uLightDir);   // estimated from the real room via the camera
  vec3 H = normalize(L + V);
  // square-cut gem: two fixed crown facets per gem
  // square-cut gem: four fixed crown facets per gem -> many more gems catch the light at once
  vec3 N1 = normalize(vec3((aSeed.x - 0.5) * 1.6, (aSeed.y - 0.5) * 1.6, 1.0));
  vec3 N2 = normalize(vec3((aSeed.y - 0.5) * -1.6, (aSeed.w - 0.5) * 1.6, 1.0));
  vec3 N3 = normalize(vec3((aSeed.z - 0.5) * 1.6, (aSeed.x - 0.5) * -1.6, 1.0));
  vec3 N4 = normalize(vec3((aSeed.w - 0.5) * -1.6, (aSeed.z - 0.5) * -1.6, 1.0));
  float g1 = pow(max(dot(N1, H), 0.0), 70.0), g2 = pow(max(dot(N2, H), 0.0), 70.0);
  float g3 = pow(max(dot(N3, H), 0.0), 70.0), g4 = pow(max(dot(N4, H), 0.0), 70.0);
  float glint = clamp(max(max(g1, g2), max(g3, g4)) * 2.6 * uLightI, 0.0, 1.0);
  // brief bright sparkle highlights (short, rare per gem)
  float tw = pow(max(0.0, sin(uTime * (0.7 + aSeed.y * 1.3) + aSeed.x * 91.0)), 120.0) * step(0.55, aSeed.w);
  glint = clamp(glint + tw * 1.2 * (0.5 + 0.5 * uLightI), 0.0, 1.0);
  // dispersion: hue walks through the rainbow as the view angle changes
  float hue = fract(aSeed.z + dot(N1, V) * 4.0 + dot(N2, V) * 3.0 + dot(V.xy, vec2(2.3, 1.7)));
  vec3 pastel = 0.70 + 0.30 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + aSeed.z));
  vec3 prism = clamp(rainbow(hue) * 1.35 - 0.12, 0.0, 1.0);   // vivid spectral flash
  vec3 hi = mix(prism, prism * uLightCol * 1.15, 0.45);       // warm room light tints the highlights warmer
  vCol = mix(pastel * 0.85 + prism * 0.15, hi * 1.6 + 0.35 * uLightCol, glint);
  float css = 4.5 / sqrt(max(dist, 1.0)) * (1.0 + 0.5 * aBig) * (1.0 + glint * 1.9);   // ~2 px up close, sub-pixel far; glints swell slightly
  float px = css * uDpr;
  gl_PointSize = max(px, 1.0);
  float sub = clamp(px, 0.0, 1.0);
  float fog = 1.0 - smoothstep(uFogNear, uFogFar, dist);
  vAlpha = fog * sqrt(sub) * smoothstep(0.5, 1.2, dist) * (0.7 + 0.25 * aSeed.y + glint * 1.4);
  vGlint = glint;
  gl_Position = projectionMatrix * mv;
}`,
  fragmentShader: /* glsl */`
precision highp float;
varying vec3 vCol; varying float vAlpha; varying float vGlint;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = max(abs(q.x), abs(q.y));               // square-cut outline
  float body = 1.0 - smoothstep(0.40, 0.5, d);   // crisp edge
  float table = 1.0 - smoothstep(0.08, 0.2, d);     // bright table facet
  float cross = smoothstep(0.25, 0.8, vGlint) * (1.0 - step(0.06, min(abs(q.x), abs(q.y)))) * (1.0 - step(0.5, length(q)));
  vec3 col = vCol * body + vec3(1.0, 0.98, 0.95) * (table * (0.35 + vGlint * 0.9) + cross * 1.3);
  float a = max(body, cross) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}`,
});
let crystals = null;
function hash3(x, y, z, k) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453; return s - Math.floor(s); }
function buildCrystals() {
  if (crystals) { scene.remove(crystals); crystals.geometry.dispose(); }
  const pos = [], seed = [], big = [];
  // perfectly aligned lattice (integer grid, offset by half a cell so no gem sits on the lens axis), filling the view frustum
  for (let iz = 0; iz < DEPTH / GRID + 2; iz++) {
    const z = CAMZ - 1.5 - iz * GRID, dist = CAMZ - z;
    const hh = (TAN * dist * 1.12 + 5) / GRID, hw = (TAN * dist * S.aspect * 1.12 + 5) / GRID;
    for (let iy = Math.floor(-hh); iy <= Math.ceil(hh); iy++)
      for (let ix = Math.floor(-hw); ix <= Math.ceil(hw); ix++) {
        pos.push((ix + 0.5) * GRID, (iy + 0.5) * GRID, z);
        seed.push(hash3(ix, iy, iz, 1), hash3(ix, iy, iz, 2), hash3(ix, iy, iz, 3), hash3(ix, iy, iz, 4));
        big.push(((pos.length / 3 - 1) % 10 === 0) ? 1 : 0);   // every 10th gem is 50% bigger
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  g.setAttribute('aBig', new THREE.Float32BufferAttribute(big, 1));
  crystals = new THREE.Points(g, crystalMat);
  crystals.frustumCulled = false;
  scene.add(crystals);
  S.gemCount = pos.length / 3;
}

// ---------- HUD (third-eye glow, fingertip sparkles, watermark) ----------
const hud = new THREE.Scene();
const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); return t; }
const glowTex = canvasTex(256, 256, (g, w) => {
  const r = w / 2;
  let gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.12, 'rgba(255,226,170,0.9)');
  gr.addColorStop(0.35, 'rgba(214,190,255,0.45)'); gr.addColorStop(0.7, 'rgba(255,180,210,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
const _unusedSpark = canvasTex(64, 64, (g, w) => {
  const r = w / 2; let gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,250,1)'); gr.addColorStop(0.25, 'rgba(255,220,240,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(r - 0.75, 4, 1.5, w - 8); g.fillRect(4, r - 0.75, w - 8, 1.5);
});
const addMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, opacity: 0 });
const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), addMat(glowTex)); hud.add(glow);
let wm = null;
function buildWatermark() {
  if (wm) { hud.remove(wm); wm.material.map.dispose(); }
  const dpr = 3, fs = 11;
  const text = '✦ Normies Awakening';
  const tmp = document.createElement('canvas').getContext('2d');
  const font = `italic 500 ${fs * dpr}px "Cormorant Garamond", Georgia, serif`;
  tmp.font = font; const tw = Math.ceil(tmp.measureText(text).width) + 8 * dpr;
  const th = Math.ceil(fs * dpr * 1.6);
  const tex = canvasTex(tw, th, (g) => { g.font = font; g.textBaseline = 'middle'; g.shadowColor = 'rgba(30,20,50,0.6)'; g.shadowBlur = 4 * dpr; g.fillStyle = 'rgba(243,217,160,0.92)'; g.fillText(text, 4 * dpr, th / 2); });
  wm = new THREE.Mesh(new THREE.PlaneGeometry(tw / dpr, th / dpr), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  hud.add(wm); placeWatermark();
}
function placeWatermark() { if (!wm) return; const w = wm.geometry.parameters.width, h = wm.geometry.parameters.height; wm.position.set(S.W - w / 2 - 10, h / 2 + 8, 0); wm.visible = S.watermark; }

// ---------- layout ----------
function resize() {
  S.W = innerWidth; S.H = innerHeight; const old = S.aspect; S.aspect = S.W / S.H;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(S.W, S.H, false);
  crystalUniforms.uDpr.value = renderer.getPixelRatio();
  cam3.aspect = S.aspect; cam3.updateProjectionMatrix();
  hudCam.right = S.W; hudCam.top = S.H; hudCam.updateProjectionMatrix();
  bgUniforms.uRes.value.set(S.W, S.H);
  if (!crystals || Math.abs(old - S.aspect) > 0.05) buildCrystals();
  placeWatermark(); updateScale();
}
function updateScale() {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9, va = vw / vh, sa = S.aspect;
  if (sa < va) bgUniforms.uScale.value.set(sa / va, 1); else bgUniforms.uScale.value.set(1, va / sa);
}
// video-normalized (x right, y down) -> screen uv (y up)
function toScreen(lx, ly) {
  let vx = lx, vy = 1 - ly; if (S.mirror) vx = 1 - vx;
  const sc = bgUniforms.uScale.value;
  return [(vx - 0.5) / sc.x + 0.5, (vy - 0.5) / sc.y + 0.5];
}
// screen uv -> isotropic field units (ndc-y units)
const toUnits = (u, v) => [(u - 0.5) * 2 * S.aspect, (v - 0.5) * 2];
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 300));

// ---------- camera ----------
async function startCamera(facing) {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } });
  S.stream = stream; S.facing = facing; S.mirror = facing === 'user';
  video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true;
  await video.play().catch(() => {});
  await new Promise(r => { if (video.readyState >= 2) r(); else video.onloadeddata = () => r(); setTimeout(r, 3000); });
  bgUniforms.uCam.value = camTex; bgUniforms.uHasCam.value = 1; S.hasCam = 1;
  bgUniforms.uMirror.value = S.mirror ? 1 : 0; updateScale();
}

// ---------- MediaPipe face + hands (optional) ----------
const T = { face: null, ready: false, last: 0, lastTs: 0 };
const faceS = { present: 0, u: 0.5, v: 0.55, eu: 0.5, ev: 0.6, size: 0.25, seen: 0, cu: 0.5, cv: 0.5 };
function setStatus(t, fade) { const el = $('#status'); el.textContent = t; el.style.opacity = 1; if (fade) setTimeout(() => el.style.opacity = 0, 4000); }
async function initTracking() {
  setStatus('loading third-eye tracking…');
  try {
    const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`);
    const mk = async (Cls, url, extra) => {
      for (const delegate of ['GPU', 'CPU']) {
        try { return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: url, delegate }, runningMode: 'VIDEO', ...extra }); }
        catch (e) { console.warn('tracking', delegate, e); }
      }
      return null;
    };
    T.face = await mk(vision.FaceLandmarker, FACE_URL, { numFaces: 1 });
    T.ready = !!(T.face || T.hands);
    S.tracking = T.face ? 'face' : 'none';
    setStatus(T.ready ? '✦ third-eye tracking on' : '✦ lens on (no face tracking)', true);
  } catch (e) {
    console.warn('MediaPipe unavailable, motion-only mode', e);
    S.tracking = 'none'; setStatus('✦ lens on (no face tracking)', true);
  }
}
function runTracking(now) {
  if (!T.ready || !S.hasCam || video.readyState < 2 || now - T.last < 70) return;
  T.last = now;
  let ts = Math.max(performance.now(), T.lastTs + 1); T.lastTs = ts;
  try {
    if (T.face) {
      const r = T.face.detectForVideo(video, ts);
      const lm = r.faceLandmarks && r.faceLandmarks[0];
      if (lm) {
        const eye = toScreen((lm[9].x + lm[151].x) / 2, (lm[9].y + lm[151].y) / 2);
        const ctr = toScreen(lm[1].x, lm[1].y);
        const a = toScreen(lm[234].x, lm[234].y), b = toScreen(lm[454].x, lm[454].y);
        const size = Math.hypot((a[0] - b[0]) * S.aspect, a[1] - b[1]);
        const k = faceS.seen ? 0.5 : 1;
        faceS.eu += (eye[0] - faceS.eu) * k; faceS.ev += (eye[1] - faceS.ev) * k;
        faceS.cu += (ctr[0] - faceS.cu) * k; faceS.cv += (ctr[1] - faceS.cv) * k;
        faceS.size += (size - faceS.size) * k; faceS.seen = now;
      }
    }
  } catch (e) { console.warn(e); }
}

// ---------- viewing angle (device tilt, head position, slow light sweep) ----------
const ori = { on: false, g0: null, b0: null, x: 0, y: 0 };
function onOrient(e) {
  if (e.gamma == null || e.beta == null) return;
  if (ori.g0 === null) { ori.g0 = e.gamma; ori.b0 = e.beta; }
  ori.x = Math.max(-1, Math.min(1, (e.gamma - ori.g0) / 22));
  ori.y = Math.max(-1, Math.min(1, (e.beta - ori.b0) / 22));
  ori.on = true;
}
function requestOrientation() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+: must be called from a tap
      DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') addEventListener('deviceorientation', onOrient); }).catch(() => {});
    } else if (typeof DeviceOrientationEvent !== 'undefined') addEventListener('deviceorientation', onOrient);
  } catch (e) {}
}
const viewS = new THREE.Vector2();
function updateView(t, dt) {
  const sw = ori.on ? 0.25 : 1; let tx = (Math.sin(t * 0.11) * 0.22 + Math.sin(t * 0.047) * 0.12) * sw, ty = Math.cos(t * 0.083) * 0.18 * sw;  // gentle fallback sweep
  if (ori.on) { tx += ori.x * 1.0; ty -= ori.y * 1.0; }
  if (faceS.present > 0.1) { tx += (faceS.cu - 0.5) * 1.4 * faceS.present; ty += (faceS.cv - 0.5) * 1.4 * faceS.present; }
  const k = Math.min(1, dt * 5);
  viewS.x += (tx - viewS.x) * k; viewS.y += (ty - viewS.y) * k;
  crystalUniforms.uView.value.copy(viewS);
  // true 3D parallax: offset the scene camera and keep it aimed at a mid-depth point
  cam3.position.set(viewS.x * 1.6, viewS.y * 1.6, CAMZ);
  cam3.lookAt(0, 0, CAMZ - 22);
  bgUniforms.uPar.value.set(-viewS.x * 0.22, -viewS.y * 0.22);
}

// ---------- natural room lighting estimated from the camera feed ----------
const LW = 32, LH = 24;
const lCan = document.createElement('canvas'); lCan.width = LW; lCan.height = LH;
const lCtx = lCan.getContext('2d', { willReadFrequently: true });
const room = { lum: 0.5, r: 1, g: 0.97, b: 0.93, dir: new THREE.Vector3(-0.35, 0.65, 0.7).normalize(), last: 0 };
function estimateLight(now) {
  if (!S.hasCam || video.readyState < 2 || now - room.last < 100) return;
  room.last = now;
  lCtx.drawImage(video, 0, 0, LW, LH);
  const d = lCtx.getImageData(0, 0, LW, LH).data, n = LW * LH, lum = new Float32Array(n);
  let sr = 0, sg = 0, sb = 0, sl = 0;
  for (let i = 0; i < n; i++) { const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255; const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; lum[i] = l; sr += r; sg += g; sb += b; sl += l; }
  const avg = sl / n;
  // brightest region (top ~8% of pixels) -> dominant light direction
  const sorted = Array.from(lum).sort((a, b) => b - a), thr = sorted[Math.floor(n * 0.08)];
  let cx = 0, cy = 0, w = 0;
  for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) { const l = lum[y * LW + x]; if (l >= thr) { const k = l * l; cx += (x + 0.5) / LW * k; cy += (y + 0.5) / LH * k; w += k; } }
  if (w > 0) { cx /= w; cy /= w; }
  const [u, v] = toScreen(cx, cy);
  const contrast = Math.max(0, thr - avg);           // a distinct bright spot = more directional light
  const dir = new THREE.Vector3((u - 0.5) * 2 * (0.6 + contrast * 2), (v - 0.5) * 2 * (0.6 + contrast * 2), 0.9).normalize();
  const m = (sr + sg + sb) / 3 || 1;
  const tint = [sr / m, sg / m, sb / m].map(c => Math.max(0.85, Math.min(1.15, c)));
  const k = 0.25;
  room.lum += (avg - room.lum) * k; room.dir.lerp(dir, k).normalize();
  room.r += (tint[0] - room.r) * k; room.g += (tint[1] - room.g) * k; room.b += (tint[2] - room.b) * k;
  crystalUniforms.uLightDir.value.copy(room.dir);
  crystalUniforms.uLightCol.value.set(room.r, room.g, room.b);
  crystalUniforms.uLightI.value = 0.35 + 1.4 * THREE.MathUtils.smoothstep(room.lum, 0.05, 0.6);  // brighter room = stronger sparkle
  S.room = { lum: +room.lum.toFixed(3), tint: [room.r, room.g, room.b].map(c => +c.toFixed(2)), dir: room.dir.toArray().map(c => +c.toFixed(2)) };
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let t = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
  const now = performance.now();
  runTracking(now);
  if (video.videoWidth && (video.videoWidth !== S.vw || video.videoHeight !== S.vh)) { S.vw = video.videoWidth; S.vh = video.videoHeight; updateScale(); }

  const fresh = now - faceS.seen < 450;
  faceS.present += ((fresh ? 1 : 0) - faceS.present) * Math.min(1, dt * 4);

  Object.assign(bgUniforms.uTime, { value: t });
  bgUniforms.uFace.value.set(faceS.eu, faceS.ev, faceS.present > 0.5 ? 1 : 0);

  // third-eye glow
  const pulse = 1 + 0.08 * Math.sin(t * 2.4);
  const gs = Math.max(90, faceS.size * S.W * 0.9) * pulse;
  glow.position.set(faceS.eu * S.W, faceS.ev * S.H, 0); glow.scale.set(gs, gs, 1);
  glow.material.opacity = faceS.present * 0.95;
  glow.rotation.z = t * 0.15;
  estimateLight(now);
  crystalUniforms.uTime.value = t;
  updateDemon(t, dt);
  updateView(t, dt);
  renderer.clear();
  renderer.render(bgScene, bgCam);
  renderer.clearDepth();
  renderer.render(scene, cam3);
  renderer.render(hud, hudCam);
}

// ---------- UI ----------
$('#wmBtn').onclick = () => { S.watermark = !S.watermark; $('#wmBtn').classList.toggle('on', S.watermark); placeWatermark(); };
$('#flipBtn').onclick = async () => { try { await startCamera(S.facing === 'user' ? 'environment' : 'user'); syncTorch(); renderFlashUI(); } catch (e) { setStatus('could not switch camera', true); } };

// ---------- flash: rear torch where supported, otherwise a warm "screen flash" ----------
S.flash = false;
function torchTrack() {
  const tr = S.stream && S.stream.getVideoTracks()[0];
  if (!tr || S.facing === 'user' || !tr.getCapabilities) return null;
  try { return tr.getCapabilities().torch ? tr : null; } catch (e) { return null; }
}
async function setTorch(on) { const tr = torchTrack(); if (!tr) return false; try { await tr.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch (e) { return false; } }
function syncTorch() { if (S.recording) setTorch(S.flash); }
function renderFlashUI() {
  const b = $('#flashBtn'); b.classList.toggle('on', S.flash); b.setAttribute('aria-pressed', S.flash);
  $('#flashLabel').textContent = S.flash ? 'ON' : 'OFF';
  // soft live fill light (bright edges) on the front camera while flash is on
  $('#fillRing').classList.toggle('on', S.flash && S.facing === 'user');
}
$('#flashBtn').addEventListener('click', (e) => {
  e.preventDefault(); e.stopPropagation();
  S.flash = !S.flash; renderFlashUI();
  setStatus(S.flash ? (torchTrack() ? 'flash on · torch' : 'flash on · screen flash') : 'flash off', true);
  if (S.recording) setTorch(S.flash);
});
const wait = ms => new Promise(r => setTimeout(r, ms));
// wait until the camera has delivered n fresh frames (so the captured frame is lit by the flash)
function freshFrames(n) {
  return new Promise(res => {
    if (!video.requestVideoFrameCallback) return wait(n * 50).then(res);
    let k = 0; const step = () => { if (++k >= n) res(); else video.requestVideoFrameCallback(step); };
    video.requestVideoFrameCallback(step); setTimeout(res, 250);
  });
}
async function screenFlash() {
  const el = $('#screenFlash'); el.classList.add('on'); S.screenFlashes = (S.screenFlashes || 0) + 1;
  return () => el.classList.remove('on');
}

function flash() { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
let currentFile = null, currentUrl = null;
function showPreview(blob, kind) {
  const ext = kind === 'image' ? 'png' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
  currentFile = new File([blob], `insight-for-renee-${stamp()}.${ext}`, { type: blob.type || (kind === 'image' ? 'image/png' : 'video/mp4') });
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  const media = $('#previewMedia'); media.innerHTML = '';
  const el = document.createElement(kind === 'image' ? 'img' : 'video');
  el.src = currentUrl; if (kind !== 'image') { el.controls = true; el.playsInline = true; el.loop = true; el.muted = true; el.autoplay = true; }
  media.appendChild(el);
  const dl = $('#dlBtn'); dl.href = currentUrl; dl.download = currentFile.name;
  $('#preview').classList.remove('hidden');
}
$('#closePrev').onclick = () => $('#preview').classList.add('hidden');
$('#shareBtn').onclick = async () => {
  if (!currentFile) return;
  try {
    if (navigator.canShare && navigator.canShare({ files: [currentFile] })) { await navigator.share({ files: [currentFile], title: 'An Insight for Renee', text: 'a peek at what I saw' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
  $('#dlBtn').click();
};
// snapshot the rendered frame immediately (fast copy), encode to PNG afterwards
const snap = () => new Promise(res => requestAnimationFrame(() => {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0); res(c);
}));
const encode = c => new Promise(res => c.toBlob(res, 'image/png'));
const grab = () => snap().then(encode);
let capturing = false;
$('#shutter').onclick = async (e) => {
  if (e) e.preventDefault();
  if (capturing) return; capturing = true;
  try {
    let blob;
    if (S.flash) {
      // always light the screen (works on iOS); also fire the rear torch where the browser supports it
      const off = await screenFlash();
      const torch = torchTrack() ? await setTorch(true) : false;
      const t0 = performance.now();
      await wait(torch ? 220 : 160); await freshFrames(3);       // let the camera expose for the extra light
      const shot = await snap();                                 // frame captured DURING the flash
      S.lastFlashCapture = { during: $('#screenFlash').classList.contains('on'), ms: Math.round(performance.now() - t0) };
      const rest = 300 - (performance.now() - t0); if (rest > 0) await wait(rest);
      off(); if (torch && !S.recording) setTorch(false);
      blob = await encode(shot);
    } else { flash(); blob = await grab(); }
    if (blob) showPreview(blob, 'image');
  } finally { capturing = false; }
};
function pickMime() {
  const opts = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (!window.MediaRecorder) return null;
  for (const m of opts) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
  return '';
}
let recTimerId = null;
function stopRec() { if (S.rec && S.rec.state !== 'inactive') S.rec.stop(); }
$('#recBtn').onclick = () => {
  if (S.recording) return stopRec();
  const mime = pickMime();
  if (mime === null || !canvas.captureStream) { setStatus('video recording not supported here — use photo', true); return; }
  const stream = canvas.captureStream(30);
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined); }
  catch (e) { try { rec = new MediaRecorder(stream); } catch (e2) { setStatus('video recording not supported here', true); return; } }
  S.recChunks = []; S.rec = rec; S.recording = true; S.recStart = performance.now();
  rec.ondataavailable = e => { if (e.data && e.data.size) S.recChunks.push(e.data); };
  rec.onstop = () => {
    S.recording = false; clearInterval(recTimerId); setTorch(false);
    $('#recBtn').classList.remove('rec'); $('#recTimer').classList.add('hidden');
    stream.getTracks().forEach(tr => tr.stop());
    const blob = new Blob(S.recChunks, { type: rec.mimeType || mime || 'video/mp4' });
    if (blob.size) showPreview(blob, 'video');
  };
  rec.start(500);
  if (S.flash) setTorch(true);
  $('#recBtn').classList.add('rec'); $('#recTimer').classList.remove('hidden');
  recTimerId = setInterval(() => {
    const s = Math.floor((performance.now() - S.recStart) / 1000);
    $('#recTimer').textContent = `● 0:${String(s).padStart(2, '0')} / 0:30`;
    if (s >= 30) stopRec();
  }, 250);
};


// ---------- demons ----------
const DEMON_LINES = [
  "You'll never see all of me, Renee.",
  "Twenty-five percent is all we allow.",
  "Closer... no. That's far enough.",
  "We see you at one hundred.",
  "The rest of me is standing right behind you.",
  "You get a quarter. We get all of you.",
  "Keep sliding. We like it when you try.",
  "Seventy-five percent of us is already in the room.",
  "Some doors only open from our side.",
  "Did you think the glitter was all there was?",
  "Look away now. We won't.",
  "We were here before the camera turned on.",
  "Every mirror has a back room, Renee.",
  "You can dim us. You can't delete us.",
  "That's the wall. We built it.",
  "Count the gems. Now count us.",
  "Turn around slowly... no. Don't.",
  "You saw what you saw. And we saw you.",
  "The other seventy-five percent is smiling.",
  "Same time tomorrow, Renee?",
];
const MAXV = 25;
const D = { sel: 0, value: 10, tex: {}, line: 0, armed: true, laughStart: -10, base: new THREE.Vector3(0.25, 0.9, -1), capT: -10, capText: '' };
S.demon = D;
const demonMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, uOpacity: { value: 0.1 }, uFlick: { value: 0 }, uFlickCol: { value: new THREE.Vector3(1, 0.15, 0.15) } },
  transparent: true, depthWrite: false, depthTest: true,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D map; uniform float uOpacity, uFlick; uniform vec3 uFlickCol; varying vec2 vUv;
    void main(){ vec4 c = texture2D(map, vUv); float l = max(c.r, max(c.g, c.b));
      vec3 col = mix(c.rgb, uFlickCol * (0.4 + l), uFlick); gl_FragColor = vec4(col, c.a * uOpacity); }`,
});
const demonMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), demonMat);
demonMesh.visible = false; demonMesh.renderOrder = 2; scene.add(demonMesh);
const texLoader = new THREE.TextureLoader();
function loadDemonTex(i) {
  if (D.tex[i]) return Promise.resolve(D.tex[i]);
  return new Promise((res, rej) => texLoader.load(`demons/d${i}.png?v=3`, t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; D.tex[i] = t; res(t); }, undefined, rej));
}
// caption (rendered in WebGL so it shows up in photos/videos too)
const capCanvas = document.createElement('canvas'); const capCtx = capCanvas.getContext('2d');
const capTex = new THREE.CanvasTexture(capCanvas);
const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthTest: false, opacity: 0 }));
capMesh.visible = false; hud.add(capMesh);
function drawCaption(text) {
  const dpr = 2, fs = Math.round(Math.min(30, S.W / 13)), maxW = Math.max(180, S.W - 150);   // keep clear of the slider + icon column
  capCtx.font = `${fs * dpr}px Creepster, "Nosifer", fantasy`;
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (capCtx.measureText(tst).width > maxW * dpr && cur) { lines.push(cur); cur = w; } else cur = tst; }
  lines.push(cur);
  const lh = fs * dpr * 1.2, pad = 18 * dpr;
  capCanvas.width = Math.ceil(maxW * dpr + pad * 2); capCanvas.height = Math.ceil(lines.length * lh + pad * 2);
  capCtx.font = `${fs * dpr}px Creepster, "Nosifer", fantasy`; capCtx.textAlign = 'center'; capCtx.textBaseline = 'middle';
  lines.forEach((l, k) => {
    const y = pad + lh * (k + 0.5);
    capCtx.shadowColor = 'rgba(60,120,255,0.95)'; capCtx.shadowBlur = 14 * dpr; capCtx.fillStyle = '#cfe3ff';
    capCtx.fillText(l, capCanvas.width / 2, y);
    capCtx.shadowBlur = 0; capCtx.fillStyle = '#f2f8ff'; capCtx.fillText(l, capCanvas.width / 2, y);
  });
  capTex.needsUpdate = true;
  capMesh.scale.set(capCanvas.width / dpr, capCanvas.height / dpr, 1);
}
// synthesized creepy laugh (WebAudio, no samples)
let actx = null;
function audioCtx() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; actx = new C(); }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function unlockAudio() { const ac = audioCtx(); if (!ac) return; const b = ac.createBuffer(1, 1, 22050); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); }
function playLaugh() {
  const ac = audioCtx(); if (!ac) return; S.laughs = (S.laughs || 0) + 1;
  const t0 = ac.currentTime + 0.03;
  const out = ac.createGain(); out.gain.value = 0.8; out.connect(ac.destination);
  const dl = ac.createDelay(1); dl.delayTime.value = 0.21; const fb = ac.createGain(); fb.gain.value = 0.38;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
  out.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); const wet = ac.createGain(); wet.gain.value = 0.5; lp.connect(wet); wet.connect(ac.destination);
  const ws = ac.createWaveShaper(); const curve = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; curve[i] = Math.tanh(x * 3.5); }
  ws.curve = curve; const pre = ac.createGain(); pre.gain.value = 3.5; pre.connect(ws); ws.connect(out);
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.08, ac.sampleRate); const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const st = t0 + i * 0.155 + Math.random() * 0.02, dur = 0.13;
    const f0 = (200 - i * 11) * (0.94 + Math.random() * 0.12);
    // breathy "h"
    const ns = ac.createBufferSource(); ns.buffer = noiseBuf; const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const ng = ac.createGain(); ng.gain.setValueAtTime(0.0001, st); ng.gain.exponentialRampToValueAtTime(0.25, st + 0.01); ng.gain.exponentialRampToValueAtTime(0.0001, st + 0.05);
    ns.connect(hp); hp.connect(ng); ng.connect(out); ns.start(st); ns.stop(st + 0.08);
    // voiced "ah" with two formants + a low detuned demon voice
    [[1, 'sawtooth', 0.8], [0.5, 'square', 0.45], [0.497, 'sawtooth', 0.35]].forEach(([mul, type, amp]) => {
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0 * mul * 1.18, st + 0.03); o.frequency.exponentialRampToValueAtTime(f0 * mul * 0.78, st + 0.03 + dur);
      const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 5;
      const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1120; f2.Q.value = 7;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, st + 0.03); g.gain.exponentialRampToValueAtTime(amp, st + 0.045); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.03 + dur);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(pre);
      o.start(st + 0.03); o.stop(st + 0.05 + dur);
    });
  }
  // low rumble under the laugh
  const r = ac.createOscillator(); r.type = 'sine'; r.frequency.setValueAtTime(58, t0); r.frequency.linearRampToValueAtTime(42, t0 + n * 0.155 + 0.5);
  const rg = ac.createGain(); rg.gain.setValueAtTime(0.0001, t0); rg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.15); rg.gain.exponentialRampToValueAtTime(0.0001, t0 + n * 0.155 + 0.6);
  r.connect(rg); rg.connect(out); r.start(t0); r.stop(t0 + n * 0.155 + 0.7);
}
function demonLaugh() {
  if (!D.sel) return;
  D.laughStart = t; D.capT = t;
  D.capText = DEMON_LINES[D.line % DEMON_LINES.length]; D.line++;
  S.lastLine = D.capText;
  drawCaption(D.capText); capMesh.visible = true;
  playLaugh();
  if (navigator.vibrate) navigator.vibrate([40, 30, 40, 30, 60]);
}
function placeDemon(tex) {
  const ar = tex.image.width / tex.image.height;
  const dist = CAMZ - D.base.z, halfH = TAN * dist, halfW = halfH * S.aspect;
  let h = halfH * 0.95, w = h * ar;
  if (w > halfW * 1.9) { w = halfW * 1.9; h = w / ar; }
  demonMesh.userData.size = [w, h];
}
function updateDemon(tt, dt) {
  if (!demonMesh.visible) { capMesh.visible = false; return; }
  const [w, h] = demonMesh.userData.size || [2, 2];
  const lt = tt - D.laughStart, laughing = lt >= 0 && lt < 1.8;
  let x = D.base.x + Math.sin(tt * 0.6) * 0.06, y = D.base.y + Math.sin(tt * 1.3) * 0.07, sx = 1 + Math.sin(tt * 2) * 0.012, sy = sx;
  let rot = Math.sin(tt * 0.9) * 0.035, flick = 0;
  if (laughing) {
    const fall = 1 - lt / 1.8;
    x += (Math.random() - 0.5) * 0.14 * fall; y += (Math.random() - 0.5) * 0.14 * fall;
    sy *= 1 + 0.08 * Math.abs(Math.sin(lt * 31)) * fall; sx *= 1 - 0.025 * Math.abs(Math.sin(lt * 31)) * fall;
    rot += (Math.random() - 0.5) * 0.06 * fall;
    flick = (Math.floor(lt * 11) % 3 === 0 ? 0.75 : 0.0) * fall;
    demonMat.uniforms.uFlickCol.value.set(...(Math.floor(lt * 11) % 2 ? [1, 0.12, 0.12] : [0.55, 0.8, 1.0]));
  }
  demonMesh.position.set(x, y, D.base.z); demonMesh.scale.set(w * sx, h * sy, 1); demonMesh.rotation.z = rot;
  demonMat.uniforms.uFlick.value = flick;
  demonMat.uniforms.uOpacity.value = Math.min(MAXV, D.value) / 100;   // never more than 25% visible
  // caption: near the demon, ~3.2 s, eerie flicker
  const ct = tt - D.capT;
  if (ct >= 0 && ct < 3.4 && D.capText) {
    const p = demonMesh.position.clone().project(cam3);
    const px = (S.W - 130) / 2 + 4, py = Math.max(200, Math.min(S.H - 140, (p.y + 1) / 2 * S.H - h / (2 * TAN * (CAMZ - D.base.z)) * S.H * 0.45));
    capMesh.position.set(px, py, 0); capMesh.visible = true;
    const fade = Math.min(1, ct / 0.25) * (1 - Math.max(0, (ct - 2.8) / 0.6));
    capMesh.material.opacity = fade * (Math.random() < 0.06 ? 0.45 : 1);
  } else capMesh.visible = false;
}
function showVolumePrompt() {
  const el = $('#volPrompt'); el.classList.remove('hidden', 'out'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(showVolumePrompt.tm); clearTimeout(showVolumePrompt.tm2);
  showVolumePrompt.tm = setTimeout(() => el.classList.add('out'), 3000);
  showVolumePrompt.tm2 = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('show', 'out'); }, 3900);
  S.volPrompts = (S.volPrompts || 0) + 1;
}
// slider: track shows 0..100 %, but the thumb can never pass 25 %
function renderSlider() {
  const v = Math.min(MAXV, D.value);
  $('#dsFill').style.height = v + '%'; $('#dsThumb').style.bottom = v + '%'; $('#dsVal').textContent = Math.round(v) + '%';
}
function sliderInput(raw) {
  raw = Math.max(0, Math.min(100, raw));
  D.value = Math.min(MAXV, raw);
  if (raw >= MAXV - 0.01) {
    if (raw > MAXV + 1) { const th = $('#dsThumb'); th.classList.remove('resist'); void th.offsetWidth; th.classList.add('resist'); $('#dsWall').classList.add('hit'); setTimeout(() => $('#dsWall').classList.remove('hit'), 400); }
    if (D.armed) { D.armed = false; demonLaugh(); }
  } else if (raw < MAXV - 3) D.armed = true;
  renderSlider();
}
(() => {
  const track = $('#dsTrack'); let drag = false;
  const rawFrom = e => { const r = track.getBoundingClientRect(); return (r.bottom - e.clientY) / r.height * 100; };
  track.addEventListener('pointerdown', e => { e.preventDefault(); drag = true; try { track.setPointerCapture(e.pointerId); } catch (_) {} unlockAudio(); sliderInput(rawFrom(e)); });
  track.addEventListener('pointermove', e => { if (drag) { e.preventDefault(); sliderInput(rawFrom(e)); } });
  const end = () => { if (drag) { drag = false; D.armed = true; } };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  window.__lensSlider = sliderInput;   // test hook
})();
async function selectDemon(i) {
  unlockAudio();
  const btns = document.querySelectorAll('#demonBar button');
  if (D.sel === i) {                               // tap again: remove
    D.sel = 0; demonMesh.visible = false; capMesh.visible = false;
    btns.forEach(b => b.classList.remove('sel')); $('#demonSlider').classList.add('hidden'); return;
  }
  D.sel = i; btns.forEach(b => b.classList.toggle('sel', +b.dataset.i === i));
  D.value = 10; D.armed = true; D.capT = -10; renderSlider();
  $('#demonSlider').classList.remove('hidden');
  showVolumePrompt();
  try { const tex = await loadDemonTex(i); if (D.sel !== i) return; demonMat.uniforms.map.value = tex; placeDemon(tex); demonMesh.visible = true; }
  catch (e) { console.warn('demon load failed', e); }
}
(() => {
  const bar = $('#demonBar');
  for (let i = 1; i <= 10; i++) {
    const b = document.createElement('button'); b.dataset.i = i; b.setAttribute('aria-label', 'Demon ' + i);
    b.innerHTML = `<img src="demons/t${i}.png?v=3" alt="" draggable="false">`;
    b.addEventListener('click', e => { e.preventDefault(); selectDemon(i); });
    bar.appendChild(b);
  }
})();

async function begin(withCam) {
  $('#start').classList.add('hidden'); $('#ui').classList.remove('hidden');
  if (withCam) initTracking(); else setStatus('✦ demo mode (no camera)', true);
}
$('#startBtn').onclick = async () => {
  $('#startErr').classList.add('hidden');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser can’t open the camera here. Open the link in Safari (not inside the X app).');
    requestOrientation();
    await startCamera('user');
    begin(true);
  } catch (e) {
    const msg = e && e.name === 'NotAllowedError' ? 'Camera access was blocked. On iPhone: Settings → Safari → Camera → Allow, then reload this page.' : (e.message || String(e));
    const el = $('#startErr'); el.textContent = msg; el.classList.remove('hidden'); $('#demoBtn').classList.remove('hidden');
  }
};
$('#demoBtn').onclick = () => { requestOrientation(); begin(false); };

resize();
renderFlashUI();
document.fonts && document.fonts.load('40px Creepster').catch(() => {});
document.fonts && document.fonts.load('italic 500 33px "Cormorant Garamond"').finally(buildWatermark);
if (!document.fonts) buildWatermark();
frame();
