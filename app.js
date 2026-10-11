// Infinity Lens ✦ Normies Awakening
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

THREE.ColorManagement.enabled = false;
const MP_VER = '0.10.14';
const FACE_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODES = ['Infinity', 'Kaleidoscope', 'Sacred Geometry'];

const $ = s => document.querySelector(s);
const canvas = $('#gl'), video = $('#video');
const S = {
  mode: 0, prevMode: 0, modeMix: 1, facing: 'user', mirror: true, watermark: true,
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
  return mix(g, c, 0.45);
}
vec3 infinityRoom(vec2 s){
  vec2 p = (s - 0.5) * 2.0 - uPar;   // vanishing point shifts with tilt (parallax)
  float dx = abs(p.x), dy = abs(p.y), d = max(dx, dy);
  float R = 0.64, t = uTime;
  vec3 col;
  if (d < R) {
    col = grade(cam(s));
    float x = log(max(d, 1e-3) / R) / log(0.72) + 0.35;
    float fr = fract(x), n = floor(x);
    float fade = 1.0 - smoothstep(0.0, 4.0, x);
    col += pal(n * 0.17 + 0.1) * smoothstep(0.07, 0.0, fr) * fade * 0.28;
    col = mix(col, col * 0.86 + vec3(0.03, 0.01, 0.06), smoothstep(R * 0.7, R, d));
  } else {
    bool horiz = dy > dx;
    float a = horiz ? p.x / d : p.y / d;
    float z = 1.0 / d;
    float w = (z - 1.0) / (1.0 / R - 1.0);
    vec2 ru = horiz ? vec2(a * 0.5 + 0.5, z * 0.55) : vec2(z * 0.55, a * 0.5 + 0.5);
    vec3 refl = grade(cam(ru));
    vec3 wall = mix(vec3(0.13, 0.08, 0.21), refl, 0.38);
    float sa = abs(fract(a * 3.0 + 0.5) - 0.5);
    float sz = fract(z * 1.6);
    float seam = smoothstep(0.012 * d, 0.0, sa) * 0.16 + smoothstep(0.02, 0.0, sz) * 0.10 + smoothstep(0.006, 0.0, abs(dx - dy)) * 0.35;
    wall += vec3(1.0, 0.9, 0.95) * seam;
    col = mix(wall, vec3(0.17, 0.11, 0.27), w * 0.55);
    col += vec3(1.0, 0.88, 0.66) * smoothstep(0.014, 0.0, abs(d - R)) * 0.8;
  }
  return col;
}
vec3 kaleido(vec2 s){
  float asp = uRes.x / uRes.y;
  vec2 c = uFace.z > 0.5 ? uFace.xy : vec2(0.5);
  vec2 p = (s - 0.5) * vec2(asp, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float seg = PI / 6.0;
  a = mod(a, 2.0 * seg); a = abs(a - seg);
  float K = 1.9;
  float lr = log(max(r, 1e-4)) / log(K) + 0.3;
  float rr = pow(K, fract(lr)) * 0.10;
  vec2 q = vec2(cos(a + PI * 0.5), sin(a + PI * 0.5)) * rr;
  vec3 col = grade(cam(c + q * vec2(1.0 / max(asp, 0.5), 1.0)));
  col *= 0.9 + 0.1 * pal(floor(lr) * 0.21);
  col += vec3(1.0, 0.88, 0.66) * smoothstep(0.05, 0.0, fract(lr)) * 0.35;
  col += vec3(0.85, 0.78, 1.0) * smoothstep(0.02, 0.0, a * r) * 0.25;
  col = mix(vec3(0.17, 0.11, 0.27), col, smoothstep(0.0, 0.14, r));
  col += pal(0.1) * exp(-r * 30.0) * 0.6;
  return col;
}
vec3 sacred(vec2 s){
  float asp = uRes.x / uRes.y;
  vec3 col = grade(cam(s));
  vec2 c = uFace.z > 0.5 ? uFace.xy : vec2(0.5, 0.55);
  vec2 p = (s - c) * vec2(asp, 1.0);
  float ang = 0.0; p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  float rr = 0.11, dm = 1e3;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    vec2 cc = vec2(float(i) + 0.5 * float(j), float(j) * 0.8660254) * rr;
    if (length(cc) > rr * 2.01) continue;
    dm = min(dm, abs(length(p - cc) - rr));
  }
  dm = min(dm, abs(length(p) - rr * 3.0));
  float px = 1.6 / uRes.y;
  float line = smoothstep(px * 2.0, 0.0, dm);
  col += mix(vec3(1.0, 0.88, 0.62), pal(length(p) * 2.0), 0.4) * (line * 0.75 + exp(-dm * 70.0) * 0.22);
  col = mix(col, vec3(0.18, 0.12, 0.29), smoothstep(0.45, 1.2, length(p)) * 0.6);
  return col;
}
vec3 modeCol(float m, vec2 s){ return m < 0.5 ? infinityRoom(s) : (m < 1.5 ? kaleido(s) : sacred(s)); }
void main(){
  vec2 s = vUv;
  vec3 col = modeCol(uMode, s);
  if (uMix < 0.999) col = mix(modeCol(uPrev, s), col, uMix);
    vec2 v = (s - 0.5) * 2.0;
  col = mix(col, vec3(0.12, 0.08, 0.2), smoothstep(0.9, 1.6, length(v)) * 0.5);
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
// Scene scale: 1 unit = 6 inches (grid spacing). Gems are pinpoints: ~2-3 px up close, sub-pixel sparkle points far away.
const GRID = 1.0, DEPTH = 46;
const crystalUniforms = { uDpr: { value: 1 }, uFogNear: { value: 8.0 }, uFogFar: { value: DEPTH }, uView: { value: new THREE.Vector2(0, 0) },
  uLightDir: { value: new THREE.Vector3(-0.35, 0.65, 0.7).normalize() }, uLightCol: { value: new THREE.Vector3(1, 0.97, 0.93) }, uLightI: { value: 1.0 } };
const crystalMat = new THREE.ShaderMaterial({
  uniforms: crystalUniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
attribute vec4 aSeed;
uniform float uDpr, uFogNear, uFogFar; uniform vec2 uView; uniform vec3 uLightDir, uLightCol; uniform float uLightI;
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
  vec3 N1 = normalize(vec3((aSeed.x - 0.5) * 1.3, (aSeed.y - 0.5) * 1.3, 1.0));
  vec3 N2 = normalize(vec3((aSeed.y - 0.5) * -1.3, (aSeed.w - 0.5) * 1.3, 1.0));
  float g1 = pow(max(dot(N1, H), 0.0), 220.0), g2 = pow(max(dot(N2, H), 0.0), 220.0);
  float glint = clamp(max(g1, g2) * 1.6 * uLightI, 0.0, 1.0);
  // dispersion: hue walks through the rainbow as the view angle changes
  float hue = fract(aSeed.z + dot(N1, V) * 4.0 + dot(N2, V) * 3.0 + dot(V.xy, vec2(2.3, 1.7)));
  vec3 pastel = 0.80 + 0.20 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + aSeed.z));
  vec3 prism = rainbow(hue);
  vec3 hi = mix(prism, prism * uLightCol * 1.15, 0.45);       // warm room light tints the highlights warmer
  vCol = mix(pastel * 0.85 + prism * 0.15, hi * 1.25 + 0.2 * uLightCol, glint);
  float css = 3.0 / sqrt(max(dist, 1.0)) * (1.0 + glint * 1.6);   // ~2 px up close, sub-pixel far; glints swell slightly
  float px = css * uDpr;
  gl_PointSize = max(px, 1.0);
  float sub = clamp(px, 0.0, 1.0);
  float fog = 1.0 - smoothstep(uFogNear, uFogFar, dist);
  vAlpha = fog * sub * smoothstep(0.5, 1.2, dist) * (0.75 + 0.25 * aSeed.y + glint * 0.8);
  vGlint = glint;
  gl_Position = projectionMatrix * mv;
}`,
  fragmentShader: /* glsl */`
precision highp float;
varying vec3 vCol; varying float vAlpha; varying float vGlint;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float d = max(abs(q.x), abs(q.y));               // square-cut outline
  float body = 1.0 - smoothstep(0.30, 0.5, d);
  float table = 1.0 - smoothstep(0.08, 0.2, d);     // bright table facet
  float cross = smoothstep(0.35, 0.9, vGlint) * (1.0 - smoothstep(0.0, 0.07, min(abs(q.x), abs(q.y)))) * (1.0 - smoothstep(0.15, 0.5, length(q)));
  vec3 col = vCol * body + vec3(1.0, 0.98, 0.95) * (table * (0.35 + vGlint * 0.6) + cross);
  float a = max(body, cross) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}`,
});
let crystals = null;
function hash3(x, y, z, k) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453; return s - Math.floor(s); }
function buildCrystals() {
  if (crystals) { scene.remove(crystals); crystals.geometry.dispose(); }
  const pos = [], seed = [];
  // perfectly aligned lattice (integer grid, offset by half a cell so no gem sits on the lens axis), filling the view frustum
  for (let iz = 0; iz < DEPTH + 2; iz++) {
    const z = CAMZ - 1 - iz * GRID, dist = CAMZ - z;
    const hh = TAN * dist * 1.12 + GRID * 2.5, hw = TAN * dist * S.aspect * 1.12 + GRID * 2.5;
    for (let iy = Math.floor(-hh); iy <= Math.ceil(hh); iy++)
      for (let ix = Math.floor(-hw); ix <= Math.ceil(hw); ix++) {
        pos.push((ix + 0.5) * GRID, (iy + 0.5) * GRID, z);
        seed.push(hash3(ix, iy, iz, 1), hash3(ix, iy, iz, 2), hash3(ix, iy, iz, 3), hash3(ix, iy, iz, 4));
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
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
  g.strokeStyle = 'rgba(255,230,180,0.55)'; g.lineWidth = 1.5;
  const rr = w * 0.09;
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.beginPath(); g.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, rr, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.arc(r, r, rr, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(r, r, rr * 2, 0, Math.PI * 2); g.stroke();
});
const sparkTex = canvasTex(64, 64, (g, w) => {
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

  S.modeMix = Math.min(1, S.modeMix + dt * 1.6);
  Object.assign(bgUniforms.uTime, { value: t });
  bgUniforms.uMode.value = S.mode; bgUniforms.uPrev.value = S.prevMode; bgUniforms.uMix.value = S.modeMix;
  bgUniforms.uFace.value.set(faceS.eu, faceS.ev, faceS.present > 0.5 ? 1 : 0);

  // third-eye glow
  const pulse = 1 + 0.08 * Math.sin(t * 2.4);
  const gs = Math.max(90, faceS.size * S.W * 0.9) * pulse;
  glow.position.set(faceS.eu * S.W, faceS.ev * S.H, 0); glow.scale.set(gs, gs, 1);
  glow.material.opacity = faceS.present * 0.95;
  glow.rotation.z = t * 0.15;
  estimateLight(now);
  updateView(t, dt);
  renderer.clear();
  renderer.render(bgScene, bgCam);
  renderer.clearDepth();
  renderer.render(scene, cam3);
  renderer.render(hud, hudCam);
}

// ---------- UI ----------
function setMode(m) {
  S.prevMode = S.mode; S.mode = m; S.modeMix = 0;
  $('#modeName').textContent = MODES[m];
  document.querySelectorAll('.pill .dots i').forEach((d, i) => d.classList.toggle('on', i === m));
}
$('#modeBtn').onclick = () => setMode((S.mode + 1) % MODES.length);
$('#wmBtn').onclick = () => { S.watermark = !S.watermark; $('#wmBtn').classList.toggle('on', S.watermark); placeWatermark(); };
$('#flipBtn').onclick = async () => { try { await startCamera(S.facing === 'user' ? 'environment' : 'user'); } catch (e) { setStatus('could not switch camera', true); } };

function flash() { const f = $('#flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
let currentFile = null, currentUrl = null;
function showPreview(blob, kind) {
  const ext = kind === 'image' ? 'png' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
  currentFile = new File([blob], `infinity-lens-${stamp()}.${ext}`, { type: blob.type || (kind === 'image' ? 'image/png' : 'video/mp4') });
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
    if (navigator.canShare && navigator.canShare({ files: [currentFile] })) { await navigator.share({ files: [currentFile], title: 'Infinity Lens' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
  $('#dlBtn').click();
};
$('#shutter').onclick = () => {
  flash();
  canvas.toBlob(b => { if (b) showPreview(b, 'image'); }, 'image/png');
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
    S.recording = false; clearInterval(recTimerId);
    $('#recBtn').classList.remove('rec'); $('#recTimer').classList.add('hidden');
    stream.getTracks().forEach(tr => tr.stop());
    const blob = new Blob(S.recChunks, { type: rec.mimeType || mime || 'video/mp4' });
    if (blob.size) showPreview(blob, 'video');
  };
  rec.start(500);
  $('#recBtn').classList.add('rec'); $('#recTimer').classList.remove('hidden');
  recTimerId = setInterval(() => {
    const s = Math.floor((performance.now() - S.recStart) / 1000);
    $('#recTimer').textContent = `● 0:${String(s).padStart(2, '0')} / 0:30`;
    if (s >= 30) stopRec();
  }, 250);
};

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

setMode(0);
resize();
document.fonts && document.fonts.load('italic 500 33px "Cormorant Garamond"').finally(buildWatermark);
if (!document.fonts) buildWatermark();
frame();
