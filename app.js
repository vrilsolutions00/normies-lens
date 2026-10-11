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
// show any runtime error on screen (tiny, bottom) so an iPhone-only failure is visible instead of silent
addEventListener('error', e => { try { S.lastError = String(e.message || e); const el = document.getElementById('status'); if (el) { el.textContent = 'err: ' + S.lastError.slice(0, 80); el.style.opacity = 1; } } catch (_) {} });
addEventListener('unhandledrejection', e => { try { S.lastError = 'promise: ' + String(e.reason && e.reason.message || e.reason); } catch (_) {} });

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
  uMix: { value: 1 }, uPar: { value: new THREE.Vector2() }, uFace: { value: new THREE.Vector3(0.5, 0.55, 0) }, uMotion: { value: 0 }, uHasCam: { value: 0 }, uBoost: { value: 0 },
};
const bgMat = new THREE.ShaderMaterial({
  uniforms: bgUniforms, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D uCam; uniform vec2 uScale; uniform float uMirror; uniform vec2 uRes; uniform float uTime;
uniform vec2 uPar; uniform float uMode; uniform float uPrev; uniform float uMix; uniform vec3 uFace; uniform float uMotion; uniform float uHasCam; uniform float uBoost;
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
  // camera feed: full-screen, fully opaque, untouched colors (no grading, no mask, no vignette, no glow)
  vec3 col = uHasCam > 0.5 ? texture2D(uCam, clamp(camUV(s), 0.0, 1.0)).rgb : vec3(0.075, 0.045, 0.125);
  gl_FragColor = vec4(col, 1.0);
}`,
});
const bgScene = new THREE.Scene();
const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

// ---------- 3D crystal field ----------
const scene = new THREE.Scene();
const FOV = 60, CAMZ = 10, TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const cam3 = new THREE.PerspectiveCamera(FOV, S.aspect, 0.1, 200);
cam3.position.set(0, 0, CAMZ);

// Static, perfectly aligned 3D grid of tiny square-cut pastel gems (rendered as points).
// Scene scale: 1 unit = 6 inches; grid spacing 4 units = 2 ft. Gems are pinpoints: ~2-3 px up close, sub-pixel sparkle points far away.
const GRID = 4.0, DEPTH = 130;   // 4 units = 2 ft spacing
const crystalUniforms = { uDpr: { value: 1 }, uFogNear: { value: 40.0 }, uFogFar: { value: DEPTH }, uView: { value: new THREE.Vector2(0, 0) },
  uLightDir: { value: new THREE.Vector3(-0.35, 0.65, 0.7).normalize() }, uLightCol: { value: new THREE.Vector3(1, 0.97, 0.93) }, uLightI: { value: 1.0 }, uTime: { value: 0 } };
const crystalMat = new THREE.ShaderMaterial({
  uniforms: crystalUniforms, transparent: true, depthWrite: false, depthTest: true,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,   // premultiplied: crisp over the camera
  vertexShader: /* glsl */`
attribute vec4 aSeed; attribute float aBig;
uniform float uDpr, uFogNear, uFogFar; uniform vec2 uView; uniform vec3 uLightDir, uLightCol; uniform float uLightI; uniform float uTime;
varying vec3 vCol; varying float vAlpha; varying float vGlint; varying vec3 vH; varying vec3 vV; varying vec4 vSeed4; varying float vScale; varying vec3 vLc; varying float vDetail;
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
  float css = 3.4 * pow(2.0 / max(dist, 1.0), 0.85) * (1.0 + 0.5 * aBig) * (1.0 + glint * 1.9);   // true perspective shrink   // ~2 px up close, sub-pixel far; glints swell slightly
  float px = css * uDpr;
  gl_PointSize = max(px, 1.0);
  gl_Position = projectionMatrix * mv;
  float sub = clamp(css * 1.25, 0.0, 1.0);   // sub-CSS-pixel gems dim instead of staying a full device pixel (DPR-independent falloff)
  // exponential falloff into the dark: ~100% near, ~50% by mid-depth, ~0 at the far end (no fog colour)
  float fog = exp(-max(dist - 5.0, 0.0) * 0.024) * (1.0 - smoothstep(uFogFar * 0.5, uFogFar, dist));   // ~50% at 34 units (17 ft), ~20% at 70, ~0 at the end
  vAlpha = fog * sub * smoothstep(0.5, 1.2, dist) * (0.7 + 0.25 * aSeed.y + glint * 1.4);
  if (vAlpha < 0.07) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // too faint: draw nothing at all (no milky dust)
  vGlint = glint; vH = H; vV = V; vSeed4 = aSeed; vScale = 1.0 + glint * 1.9; vLc = uLightCol * (0.6 + 0.4 * uLightI);
  vDetail = smoothstep(5.0, 12.0, px);   // facets only where the sprite has enough device pixels to show them
  gl_Position = projectionMatrix * mv;
}`,
  fragmentShader: /* glsl */`
precision highp float;
varying vec3 vCol; varying float vAlpha; varying float vGlint; varying vec3 vH; varying vec3 vV; varying vec4 vSeed4; varying float vScale; varying vec3 vLc; varying float vDetail;
vec3 rainbow(float h){ return 0.5 + 0.5 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67))); }
void main(){
  vec2 raw = gl_PointCoord - 0.5;
  vec2 q = raw * vScale;                                      // gem body; sprite grows only to fit the star glint
  float rot = vSeed4.x * 6.2831853;
  q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * q;
  // brilliant-cut outline: regular octagon, 8 crown facets around a flat table
  float oct = max(max(abs(q.x), abs(q.y)), (abs(q.x) + abs(q.y)) * 0.7071);
  float inside = step(oct, mix(0.62, 0.46, vDetail));   // tiny sprites: keep the whole pixel footprint
  float ang = atan(q.y, q.x);
  float k = floor((ang + 3.14159265) / 0.78539816);            // facet index 0..7
  float ac = (k + 0.5) * 0.78539816 - 3.14159265;
  float isTable = step(oct, 0.20);
  float slope = mix(0.85, 0.0, isTable);
  vec3 N = normalize(vec3(cos(ac + rot) * slope, -sin(ac + rot) * slope * -1.0, 1.0));
  vec3 H = normalize(vH), V = normalize(vV);
  float spec = pow(max(dot(N, H), 0.0), 60.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  // prismatic dispersion: each facet throws a different spectral color as tilt changes
  vec3 disp = clamp(rainbow(vSeed4.z + k * 0.137 + dot(N, V) * 5.0 + dot(V.xy, vec2(3.1, 2.3))) * 1.35 - 0.1, 0.0, 1.0);
  float facetShade = 0.55 + 0.45 * fract(sin(k * 12.9898 + vSeed4.y * 78.233) * 43758.5453);   // crisp per-facet contrast
  // thin dark facet edges (crisp, not blurred)
  float edge = 1.0 - step(0.035, abs(fract((ang + 3.14159265) / 0.78539816 + 0.5) - 0.5)) * (1.0 - isTable);
  float girdle = step(0.43, oct);
  vec3 body = vCol * (0.35 + 0.35 * facetShade);              // clear, lightly tinted body
  vec3 col = body + disp * (spec * 1.8 + fres * 0.35 + vGlint * 0.6) * vLc + vec3(1.0) * spec * 0.9;
  float tableRing = (1.0 - step(0.02, abs(oct - 0.20)));
  col *= 1.0 - 0.45 * clamp(edge * (1.0 - isTable) + tableRing + girdle * 0.6, 0.0, 1.0);
  float a = inside * (0.38 + 0.25 * facetShade + spec * 0.6 + vGlint * 0.4);
  // pinpoint gems (a few device px): a crisp bright spectral point instead of sub-pixel facet detail
  vec3 pin = vCol * 1.05 + disp * vGlint * 0.8 * vLc;
  col = mix(pin, col, vDetail);
  a = mix(inside * (0.85 + vGlint * 0.15), a, vDetail);
  // star-glint sparkle on hits: crisp 4 + 4 point rays
  float s4 = (1.0 - step(0.035, abs(raw.x))) + (1.0 - step(0.035, abs(raw.y)));
  float s8 = (1.0 - step(0.025, abs(raw.x - raw.y))) + (1.0 - step(0.025, abs(raw.x + raw.y)));
  float star = smoothstep(0.35, 0.9, vGlint) * clamp(s4 + s8 * 0.5, 0.0, 1.0) * (1.0 - step(0.5, length(raw)));
  col += vec3(1.0, 0.98, 0.94) * star * 1.4;
  a = max(a, star);
  a = clamp(a * vAlpha, 0.0, 1.0);
  if (a < 0.03) discard;
  gl_FragColor = vec4(col * vAlpha * max(inside, star), a);
}`,
});
let crystals = null;
function hash3(x, y, z, k) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453; return s - Math.floor(s); }
function buildCrystals() {
  if (crystals) { scene.remove(crystals); crystals.geometry.dispose(); }
  const pos = [], seed = [], big = [];
  // perfectly aligned lattice (integer grid, offset by half a cell so no gem sits on the lens axis), filling the view frustum
  for (let iz = 0; iz < DEPTH / GRID + 2; iz++) {
    const z = CAMZ - 2.0 - iz * GRID, dist = CAMZ - z;
    const hh = (TAN * dist * 1.12 + 8) / GRID, hw = (TAN * dist * S.aspect * 1.12 + 8) / GRID;
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
  window.__lensGems = v => { crystals.visible = v; };
}

// ---------- HUD (third-eye glow, fingertip sparkles, watermark) ----------
const hud = new THREE.Scene();
const hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); return t; }
const glowTex = canvasTex(128, 128, (g, w) => {
  // tiny crisp four-point star (no soft glow)
  const r = w / 2; g.fillStyle = '#fffaf0';
  g.beginPath(); g.moveTo(r, 4); g.lineTo(r + 6, r - 6); g.lineTo(w - 4, r); g.lineTo(r + 6, r + 6); g.lineTo(r, w - 4); g.lineTo(r - 6, r + 6); g.lineTo(4, r); g.lineTo(r - 6, r - 6); g.closePath(); g.fill();
  g.fillStyle = '#ffe6a8'; g.beginPath(); g.arc(r, r, 5, 0, Math.PI * 2); g.fill();
});
const _unusedSpark = canvasTex(64, 64, (g, w) => {
  const r = w / 2; let gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,250,1)'); gr.addColorStop(0.25, 'rgba(255,220,240,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(r - 0.75, 4, 1.5, w - 8); g.fillRect(4, r - 0.75, w - 8, 1.5);
});
const addMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
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
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 3));   // native DPR (iPhone = 3)
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
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } } });
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
  crystalUniforms.uLightI.value = 0.6 + 1.15 * THREE.MathUtils.smoothstep(room.lum, 0.05, 0.6);  // brighter room = stronger sparkle
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
  const gs = 26 * pulse;
  glow.position.set(faceS.eu * S.W, faceS.ev * S.H, 0); glow.scale.set(gs, gs, 1);
  glow.material.opacity = faceS.present * 0.95;
  glow.rotation.z = t * 0.15;
  estimateLight(now);
  crystalUniforms.uTime.value = t;
  updateDemon(t, dt);
  updateView(t, dt);
  renderer.clear();
  renderer.render(bgScene, bgCam);
  renderer.render(dScene, hudCam);
  renderer.clearDepth();
  renderer.render(scene, cam3);
  renderer.render(hud, hudCam);
}

// ---------- UI ----------
$('#wmBtn').onclick = () => { S.watermark = !S.watermark; $('#wmBtn').classList.toggle('on', S.watermark); placeWatermark(); };
$('#flipBtn').onclick = async () => { try { await startCamera(S.facing === 'user' ? 'environment' : 'user'); syncTorch(); renderFlashUI(); dev.init = false; D.anchor = null; } catch (e) { setStatus('could not switch camera', true); } };

// ---------- flash: rear torch where supported, otherwise a warm "screen flash" ----------
S.flash = false;
function torchTrack() {
  try {
    const tr = S.stream && S.stream.getVideoTracks && S.stream.getVideoTracks()[0];
    if (!tr || S.facing === 'user' || typeof tr.getCapabilities !== 'function') return null;
    const caps = tr.getCapabilities() || {};
    return caps.torch ? tr : null;
  } catch (e) { return null; }
}
async function setTorch(on) { const tr = torchTrack(); if (!tr) return false; try { await tr.applyConstraints({ advanced: [{ torch: on }] }); return true; } catch (e) { return false; } }
function syncTorch() { if (S.recording) setTorch(S.flash); }
function renderFlashUI() {
  const b = $('#flashBtn'); b.classList.toggle('on', S.flash); b.setAttribute('aria-pressed', S.flash);
  $('#flashLabel').textContent = S.flash ? 'FLASH ON' : 'FLASH OFF';
  $('#flashState').textContent = S.flash ? '⚡ flash on' : '';
  $('#flashState').classList.toggle('on', S.flash);
  // soft live fill light (bright edges) on the front camera while flash is on
  $('#fillRing').classList.toggle('on', S.flash);   // flash ON: thick white fill-light frame around the edge; the camera image itself is never tinted or brightened
}
function flashToast(t) {
  const el = $('#flashToast'); el.textContent = t; el.classList.remove('hidden'); el.classList.add('show');
  clearTimeout(flashToast.tm); flashToast.tm = setTimeout(() => { el.classList.remove('show'); el.classList.add('hidden'); }, 3200);
}
function toggleFlash() {
  // state + visible UI FIRST, then anything that could throw on iOS (torch / capabilities / toast) is isolated
  S.flash = !S.flash; S.flashToggles = (S.flashToggles || 0) + 1;
  const b = $('#flashBtn');
  if (b) { b.classList.toggle('on', S.flash); b.setAttribute('aria-pressed', S.flash ? 'true' : 'false'); }
  const lbl = $('#flashLabel'); if (lbl) lbl.textContent = S.flash ? 'FLASH ON' : 'FLASH OFF';
  try { renderFlashUI(); } catch (e) { S.flashErr = String(e); }
  let torch = null; try { torch = torchTrack(); } catch (e) { torch = null; }
  try { flashToast(S.flash ? (torch ? 'Flash on (LED torch + screen flash)' : "Flash on (screen flash, iPhone browsers can't use the LED)") : 'Flash off'); } catch (e) {}
  try { if (S.recording) setTorch(S.flash).catch(() => {}); } catch (e) {}
}
// Bound only once the element exists; one toggle per physical tap (touchend / pointerup / click all de-duplicated).
// A document-level capture listener also catches taps that land inside the button's rectangle even if some
// other layer were ever on top of it.
function bindFlash() {
  const btn = $('#flashBtn'); if (!btn || btn.dataset.bound) return; btn.dataset.bound = '1';
  let last = 0;
  const fire = (e) => { if (e && e.cancelable) e.preventDefault(); const n = Date.now(); if (n - last < 350) return; last = n; toggleFlash(); };
  btn.addEventListener('touchend', e => { e.stopPropagation(); fire(e); }, { passive: false });
  btn.addEventListener('pointerup', e => { e.stopPropagation(); fire(e); });
  btn.addEventListener('click', e => { e.stopPropagation(); fire(e); });
  document.addEventListener('touchend', e => {
    if (btn.classList.contains('hidden') || btn.contains(e.target)) return;
    const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
    const r = btn.getBoundingClientRect();
    if (t.clientX >= r.left - 14 && t.clientX <= r.right + 14 && t.clientY >= r.top - 14 && t.clientY <= r.bottom + 14) { S.flashRescued = (S.flashRescued || 0) + 1; fire(e); }
  }, { capture: true, passive: false });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindFlash); else bindFlash();
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
      await wait(torch ? 240 : 200); await freshFrames(3);       // let the camera expose for the extra light
      const shot = await snap();                                 // frame captured DURING the flash
      S.lastFlashCapture = { during: $('#screenFlash').classList.contains('on'), ms: Math.round(performance.now() - t0) };
      const rest = 420 - (performance.now() - t0);   // ~400 ms of pure white if (rest > 0) await wait(rest);
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
// each demon speaks its own 6 lines (all 20 covered across the 10 demons), pre-rendered in its own voice
const VOICE = {"1":[{"line":0,"file":"l01.m4a","laugh":2.07,"dur":4.29},{"line":1,"file":"l02.m4a","laugh":2.07,"dur":4.6},{"line":2,"file":"l03.m4a","laugh":2.07,"dur":4.29},{"line":3,"file":"l04.m4a","laugh":2.07,"dur":3.72},{"line":4,"file":"l05.m4a","laugh":2.07,"dur":4.52},{"line":5,"file":"l06.m4a","laugh":2.07,"dur":4.26}],"2":[{"line":2,"file":"l03.m4a","laugh":3.05,"dur":5.66},{"line":3,"file":"l04.m4a","laugh":3.05,"dur":5.28},{"line":4,"file":"l05.m4a","laugh":3.05,"dur":6.25},{"line":5,"file":"l06.m4a","laugh":3.05,"dur":5.8},{"line":6,"file":"l07.m4a","laugh":3.05,"dur":6.22},{"line":7,"file":"l08.m4a","laugh":3.05,"dur":6.98}],"3":[{"line":4,"file":"l05.m4a","laugh":2.63,"dur":6.62},{"line":5,"file":"l06.m4a","laugh":2.63,"dur":6.47},{"line":6,"file":"l07.m4a","laugh":2.63,"dur":7.04},{"line":7,"file":"l08.m4a","laugh":2.63,"dur":7.08},{"line":8,"file":"l09.m4a","laugh":2.63,"dur":6.32},{"line":9,"file":"l10.m4a","laugh":2.63,"dur":6.33}],"4":[{"line":6,"file":"l07.m4a","laugh":1.29,"dur":3.32},{"line":7,"file":"l08.m4a","laugh":1.29,"dur":4.07},{"line":8,"file":"l09.m4a","laugh":1.29,"dur":3.36},{"line":9,"file":"l10.m4a","laugh":1.29,"dur":2.97},{"line":10,"file":"l11.m4a","laugh":1.29,"dur":2.88},{"line":11,"file":"l12.m4a","laugh":1.29,"dur":3.05}],"5":[{"line":8,"file":"l09.m4a","laugh":1.27,"dur":3.37},{"line":9,"file":"l10.m4a","laugh":1.27,"dur":3.01},{"line":10,"file":"l11.m4a","laugh":1.27,"dur":2.77},{"line":11,"file":"l12.m4a","laugh":1.27,"dur":2.99},{"line":12,"file":"l13.m4a","laugh":1.27,"dur":3.25},{"line":13,"file":"l14.m4a","laugh":1.27,"dur":3.16}],"6":[{"line":10,"file":"l11.m4a","laugh":1.44,"dur":3.68},{"line":11,"file":"l12.m4a","laugh":1.44,"dur":3.9},{"line":12,"file":"l13.m4a","laugh":1.44,"dur":4.02},{"line":13,"file":"l14.m4a","laugh":1.44,"dur":4.15},{"line":14,"file":"l15.m4a","laugh":1.44,"dur":3.7},{"line":15,"file":"l16.m4a","laugh":1.44,"dur":4.01}],"7":[{"line":12,"file":"l13.m4a","laugh":1.47,"dur":4.88},{"line":13,"file":"l14.m4a","laugh":1.47,"dur":4.7},{"line":14,"file":"l15.m4a","laugh":1.47,"dur":4.13},{"line":15,"file":"l16.m4a","laugh":1.47,"dur":4.74},{"line":16,"file":"l17.m4a","laugh":1.47,"dur":4.39},{"line":17,"file":"l18.m4a","laugh":1.47,"dur":4.77}],"8":[{"line":14,"file":"l15.m4a","laugh":1.59,"dur":4.16},{"line":15,"file":"l16.m4a","laugh":1.59,"dur":3.97},{"line":16,"file":"l17.m4a","laugh":1.59,"dur":3.61},{"line":17,"file":"l18.m4a","laugh":1.59,"dur":4.11},{"line":18,"file":"l19.m4a","laugh":1.59,"dur":5.56},{"line":19,"file":"l20.m4a","laugh":1.59,"dur":3.23}],"9":[{"line":16,"file":"l17.m4a","laugh":3.79,"dur":7.51},{"line":17,"file":"l18.m4a","laugh":3.79,"dur":7.03},{"line":18,"file":"l19.m4a","laugh":3.79,"dur":7.23},{"line":19,"file":"l20.m4a","laugh":3.79,"dur":6.64},{"line":0,"file":"l01.m4a","laugh":3.79,"dur":6.87},{"line":1,"file":"l02.m4a","laugh":3.79,"dur":6.98}],"10":[{"line":18,"file":"l19.m4a","laugh":2.18,"dur":5.63},{"line":19,"file":"l20.m4a","laugh":2.18,"dur":4.84},{"line":0,"file":"l01.m4a","laugh":2.18,"dur":5.12},{"line":1,"file":"l02.m4a","laugh":2.18,"dur":5.44},{"line":2,"file":"l03.m4a","laugh":2.18,"dur":5.15},{"line":3,"file":"l04.m4a","laugh":2.18,"dur":4.51}]};
const MAXV = 25;
const OPACITY_SCALE = 0.5;   // actual demon opacity = displayed slider value x 0.5
const D = { sel: 0, value: 10, tex: {}, idx: 0, armed: true, laughStart: -10, laughDur: 1.8, capT: -10, capDur: 3.4, capText: '',
  anchor: null, prompted: false, twitchAt: 3, twitchT: -10, twitchDir: 1, glitchAt: 8, glitchT: -10, sx: -1, sy: -1, vis: true };
S.demon = D;

// ---- iOS-robust audio: HTMLAudioElement (plays with the silent switch on) + WebAudio fallback ----
const SILENT_WAV = 'data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';   // 0.1 s of silence
const voiceEl = new Audio(); voiceEl.preload = 'auto'; voiceEl.setAttribute('playsinline', ''); voiceEl.crossOrigin = 'anonymous';
let actx = null, audioUnlocked = false;
const voiceCache = {};   // url -> { blobUrl, buf }
function audioCtx() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { actx = new C(); } catch (e) { return null; } }
  if (actx.state !== 'running') actx.resume().catch(() => {});
  return actx;
}
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}   // iOS 17+: ignore the ring/silent switch
  const ac = audioCtx();
  if (ac) { try { const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); } catch (e) {} }
  if (!audioUnlocked || voiceEl.paused) {
    if (!voiceEl.src || voiceEl.src.startsWith('data:') || !audioUnlocked) {
      voiceEl.muted = false; voiceEl.src = SILENT_WAV;
      const p = voiceEl.play(); if (p && p.then) p.then(() => { audioUnlocked = true; S.audioUnlocked = true; }).catch(() => {});
    }
  }
}
async function preloadVoice(i) {
  for (const v of (VOICE[i] || [])) {
    const url = `demons/voice/d${i}/${v.file}?v=6`;
    if (voiceCache[url]) continue;
    voiceCache[url] = {};
    fetch(url).then(r => r.ok ? r.blob() : Promise.reject(r.status)).then(b => { voiceCache[url].blobUrl = URL.createObjectURL(b); return b.arrayBuffer(); })
      .then(ab => { const ac = audioCtx(); if (ac) ac.decodeAudioData(ab.slice(0), buf => { voiceCache[url].buf = buf; }, () => {}); })
      .catch(e => console.warn('voice preload', url, e));
  }
}
function playVoice(url, onStart) {
  const c = voiceCache[url] || {};
  let started = false; const go = () => { if (!started) { started = true; onStart && onStart(); } };
  const viaWebAudio = () => {
    const ac = audioCtx();
    if (ac && c.buf) { const s = ac.createBufferSource(); s.buffer = c.buf; s.connect(ac.destination); s.start(); S.audioPath = 'webaudio'; go(); return true; }
    playLaugh(); S.audioPath = 'synth'; go(); return false;
  };
  try {
    voiceEl.pause(); voiceEl.src = c.blobUrl || url; voiceEl.currentTime = 0;
    const p = voiceEl.play();
    S.audioPath = 'audio-element';
    if (p && p.then) p.then(go).catch(e => { console.warn('audio element blocked, using WebAudio', e); viaWebAudio(); });
    else go();
    setTimeout(() => { if (!started) viaWebAudio(); }, 900);
  } catch (e) { viaWebAudio(); }
  S.voicePlays = (S.voicePlays || 0) + 1; S.lastVoice = url;
}
// synthesized laugh: last-resort fallback only
function playLaugh() {
  const ac = audioCtx(); if (!ac) return; const t0 = ac.currentTime + 0.03, n = 8;
  const out = ac.createGain(); out.gain.value = 0.7; out.connect(ac.destination);
  for (let i = 0; i < n; i++) {
    const st = t0 + i * 0.16, f0 = 190 - i * 10;
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.15, st); o.frequency.exponentialRampToValueAtTime(f0 * 0.8, st + 0.13);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 4;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(1.2, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.13);
    o.connect(bp); bp.connect(g); g.connect(out); o.start(st); o.stop(st + 0.15);
  }
}

// ---- rendering: demon drawn in screen space between the camera feed and the gems ----
const dScene = new THREE.Scene();
const demonMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, uPersp: { value: 0 }, uOpacity: { value: 0.1 }, uFlick: { value: 0 }, uFlickCol: { value: new THREE.Vector3(1, 0.15, 0.15) },
    uTime: { value: 0 }, uBreath: { value: 0 }, uTilt: { value: 0 }, uFlex: { value: 0 }, uStep: { value: 0 }, uJaw: { value: 0 }, uGlitch: { value: 0 }, uEye: { value: 0 } },
  transparent: true, depthWrite: false, depthTest: false,
  vertexShader: /* glsl */`
uniform float uBreath, uTilt, uFlex, uStep, uJaw, uPersp;
varying vec2 vUv;
void main(){
  vec3 p = position;
  // slow predatory breathing: the rib cage heaves
  float torso = smoothstep(0.2, 0.45, uv.y) * (1.0 - smoothstep(0.55, 0.85, uv.y));
  p.x *= 1.0 + uBreath * 0.05 * torso;
  p.y += uBreath * 0.014 * smoothstep(0.3, 1.0, uv.y);
  // head tilt around the neck
  float head = smoothstep(0.58, 0.85, uv.y);
  vec2 piv = vec2(0.0, 0.16), r = p.xy - piv;
  float a = uTilt * head;
  p.xy = mix(p.xy, piv + mat2(cos(a), -sin(a), sin(a), cos(a)) * r, head);
  // jaw-ish stretch on the upper part
  p.y += uJaw * 0.03 * head;
  // wings / arms flex at the outer edges
  float outer = pow(abs(uv.x - 0.5) * 2.0, 2.0);
  p.y += uFlex * 0.05 * outer * smoothstep(0.3, 0.9, uv.y);
  p.x += sign(uv.x - 0.5) * uFlex * 0.018 * outer;
  // limbs creep (lower body skews)
  float low = 1.0 - smoothstep(0.0, 0.38, uv.y);
  p.x += low * 0.025 * uStep;
  // surface perspective: the part of the body farther along the floor/ceiling/wall gets narrower
  p.x *= 1.0 + uPersp * (uv.y - 0.5) * 2.0;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
  fragmentShader: /* glsl */`
uniform sampler2D map; uniform float uOpacity, uFlick, uGlitch, uEye, uTime; uniform vec3 uFlickCol;
varying vec2 vUv;
void main(){
  vec2 uv = vUv;
  if (uGlitch > 0.0) {   // rare glitch-stutter: torn horizontal bands
    float band = floor(uv.y * 22.0);
    float h = fract(sin(band * 91.7 + floor(uTime * 24.0) * 13.1) * 43758.5);
    if (h > 0.62) uv.x += (h - 0.81) * 0.12 * uGlitch;
  }
  vec4 c = texture2D(map, uv);
  float l = max(c.r, max(c.g, c.b));
  vec3 col = c.rgb * (1.0 + uEye * 1.4 * smoothstep(0.55, 0.95, l));   // flickering eye/bone glow
  col = mix(col, uFlickCol * (0.4 + l), uFlick);
  float a = c.a * smoothstep(0.16, 0.5, c.a);   // keep only the body: drop the faint halo so no glow washes over the scene
  gl_FragColor = vec4(col, a * uOpacity);
}`,
});
const demonMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 12, 16), demonMat);
demonMesh.visible = false;
// subtle contact shadow (floor demons only): small dark ellipse under the feet
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 16, 2, 64, 16, 62); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.setTransform(1, 0, 0, 0.25, 0, 12); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); return t; })();
const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthTest: false, opacity: 0 }));
shadowMesh.visible = false; dScene.add(shadowMesh); dScene.add(demonMesh);
const texLoader = new THREE.TextureLoader();
function loadDemonTex(i) {
  if (D.tex[i]) return Promise.resolve(D.tex[i]);
  return new Promise((res, rej) => texLoader.load(`demons/d${i}.png?v=6`, t => { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; D.tex[i] = t; res(t); }, undefined, rej));
}

// ---- world anchoring with DeviceOrientation (alpha/beta/gamma) ----
const dev = { has: false, a: 0, b: 0, g: 0, yaw: 0, pitch: 0, init: false };
addEventListener('deviceorientation', e => {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  dev.a = e.alpha; dev.b = e.beta; dev.g = e.gamma; dev.has = true;
});
const rad = Math.PI / 180;
function camDirection() {
  // W3C rotation R = Rz(alpha) Rx(beta) Ry(gamma); rear camera looks along -Z of the device, front camera along +Z
  const ca = Math.cos(dev.a * rad), sa = Math.sin(dev.a * rad), cb = Math.cos(dev.b * rad), sb = Math.sin(dev.b * rad), cg = Math.cos(dev.g * rad), sg = Math.sin(dev.g * rad);
  let x = ca * sg + sa * sb * cg, y = sa * sg - ca * sb * cg, z = cb * cg;     // third column of R
  if (S.facing !== 'user') { x = -x; y = -y; z = -z; }
  return { yaw: Math.atan2(x, y), pitch: Math.asin(Math.max(-1, Math.min(1, z))) };
}
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const TANV = Math.tan(30 * rad);   // ~60° vertical view in portrait after the cover crop
function updateDevDir() {
  if (!dev.has) return;
  const d = camDirection();
  if (!dev.init) { dev.yaw = d.yaw; dev.pitch = d.pitch; dev.init = true; return; }
  dev.yaw = wrapA(dev.yaw + wrapA(d.yaw - dev.yaw) * 0.35); dev.pitch += (d.pitch - dev.pitch) * 0.35;   // light smoothing
}
// ---- surface placement (no WebXR on iOS: use world pitch from DeviceOrientation to put each demon on a plausible
// surface, never at eye level where the furniture is) ----
//   ceiling: 55-75° up, upside-down, clinging   |   wall: high corner 35-45° up, off to the side, sideways on the wall
//   floor:   45-65° down, crouched, ground perspective + contact shadow
const SURFACE = { 1: 'wall', 2: 'ceiling', 3: 'floor', 4: 'floor', 5: 'ceiling', 6: 'wall', 7: 'floor', 8: 'floor', 9: 'ceiling', 10: 'wall' };
const SURF_CFG = {
  //            pitch range (deg)  yaw offset (deg)  fallback screen spot (NDC)   size (x screen H)  rotation          perspective  y-squash
  ceiling: { p: [55, 75],  yaw: [6, 16],  fb: { x: -0.30, y: 0.72 }, size: 0.21, rot: Math.PI,       persp: -0.22, sq: 0.78 },
  wall:    { p: [35, 45],  yaw: [20, 30], fb: { x: -0.66, y: 0.58 }, size: 0.19, rot: Math.PI / 2.2, persp: -0.20, sq: 0.90 },
  floor:   { p: [-65, -45], yaw: [6, 18],  fb: { x: -0.30, y: -0.40 }, size: 0.22, rot: 0,           persp: -0.24, sq: 0.74 },
};
function surfOf(i) { return SURFACE[i] || 'floor'; }
function anchorDemon() {
  const cfg = SURF_CFG[surfOf(D.sel)];
  D.side = Math.random() < 0.5 ? -1 : 1;
  D.surf = surfOf(D.sel);
  D.enterT = t; D.enterFrom = null;
  if (dev.has && dev.init) {
    const sgn = S.facing === 'user' ? -1 : 1;   // keep "left/right of the screen" consistent for the mirrored front view
    D.anchor = { yaw: wrapA(dev.yaw + D.side * sgn * rnd(cfg.yaw[0], cfg.yaw[1]) * rad), pitch: rnd(cfg.p[0], cfg.p[1]) * rad };   // absolute world pitch
  } else D.anchor = null;
  S.demonAnchored = !!D.anchor; S.demonSurface = D.surf;
}
function demonScreenNDC() {
  const cfg = SURF_CFG[D.surf || 'floor'];
  if (!D.anchor) { if (dev.has && dev.init && D.sel) anchorDemon(); }
  if (!D.anchor) return { x: Math.min(0.40, cfg.fb.x * (D.side || -1) * -1), y: cfg.fb.y, on: true };   // right side stays clear of the icon column    // fallback: fixed spot on that surface's side of the frame
  // true 3D projection of the world-anchored direction into the current camera frame (correct when looking up/down)
  const sgn = S.facing === 'user' ? -1 : 1, tanH = TANV * S.aspect;
  const dir = (yw, pt) => [Math.cos(pt) * Math.sin(yw), Math.cos(pt) * Math.cos(yw), Math.sin(pt)];
  const A = dir(D.anchor.yaw, D.anchor.pitch), F = dir(dev.yaw, dev.pitch);
  const Rt = [Math.cos(dev.yaw), -Math.sin(dev.yaw), 0];
  const Up = [Rt[1] * F[2] - Rt[2] * F[1], Rt[2] * F[0] - Rt[0] * F[2], Rt[0] * F[1] - Rt[1] * F[0]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const cx = dot(A, Rt), cy = dot(A, Up), cz = dot(A, F);
  if (cz < 0.25) return { x: Math.sign(sgn * cx || 1) * 3, y: Math.sign(cy || 1) * 3, on: false };
  return { x: sgn * (cx / cz) / tanH, y: (cy / cz) / TANV, on: true };
}
// ---- caption (in WebGL so it is captured) ----
const capCanvas = document.createElement('canvas'); const capCtx = capCanvas.getContext('2d');
const capTex = new THREE.CanvasTexture(capCanvas);
const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: capTex, transparent: true, depthTest: false, opacity: 0 }));
capMesh.visible = false; hud.add(capMesh);
function drawCaption(text) {
  const dpr = 2, fs = Math.round(Math.min(30, S.W / 13)), maxW = Math.max(180, S.W - 150);
  capCtx.font = `${fs * dpr}px Creepster, "Nosifer", fantasy`;
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (capCtx.measureText(tst).width > maxW * dpr && cur) { lines.push(cur); cur = w; } else cur = tst; }
  lines.push(cur);
  const lh = fs * dpr * 1.2, pad = 18 * dpr;
  capCanvas.width = Math.ceil(maxW * dpr + pad * 2); capCanvas.height = Math.ceil(lines.length * lh + pad * 2);
  capCtx.font = `${fs * dpr}px Creepster, "Nosifer", fantasy`; capCtx.textAlign = 'center'; capCtx.textBaseline = 'middle';
  lines.forEach((l, k) => {
    const y = pad + lh * (k + 0.5);
    capCtx.shadowColor = 'rgba(60,120,255,0.95)'; capCtx.shadowBlur = 10 * dpr; capCtx.fillStyle = '#cfe3ff'; capCtx.fillText(l, capCanvas.width / 2, y);
    capCtx.shadowBlur = 0; capCtx.fillStyle = '#f2f8ff'; capCtx.fillText(l, capCanvas.width / 2, y);
  });
  capTex.dispose(); capTex.needsUpdate = true;   // canvas size changes per line: re-allocate the GPU texture (otherwise the old caption stays)
  capMesh.scale.set(capCanvas.width / dpr, capCanvas.height / dpr, 1);
}

function demonLaugh() {
  if (!D.sel) return;
  if (!D.prompted) { D.prompted = true; showVolumePrompt(); }   // only at the wall, once per selection
  const list = VOICE[D.sel] || [];
  const v = list.length ? list[D.idx % list.length] : null; D.idx++;
  const li = v ? v.line : (D.idx - 1) % DEMON_LINES.length;
  D.capText = DEMON_LINES[li]; S.lastLine = D.capText;
  drawCaption(D.capText);
  const laughDur = v ? v.laugh : 1.6, total = v ? v.dur : 3.4;
  const start = () => { D.laughStart = t; D.laughDur = laughDur; D.capT = t + laughDur * 0.85; D.capDur = Math.max(2.6, total - laughDur + 0.9); };
  start();   // visuals start immediately (audio start re-syncs below)
  if (v) playVoice(`demons/voice/d${D.sel}/${v.file}?v=6`, start); else playLaugh();
  if (navigator.vibrate) navigator.vibrate([40, 30, 40, 30, 60]);
}
function placeDemon(tex) {
  const ar = tex.image.width / tex.image.height;
  let h = S.H * SURF_CFG[surfOf(D.sel)].size, w = h * ar;
  if (w > S.W * 0.95) { w = S.W * 0.95; h = w / ar; }
  demonMesh.userData.size = [w, h];
}
const rnd = (a, b) => a + Math.random() * (b - a);
function updateDemon(tt, dt) {
  updateDevDir();
  if (!demonMesh.visible) { capMesh.visible = false; shadowMesh.visible = false; return; }
  const [w, h] = demonMesh.userData.size || [200, 200];
  const u = demonMat.uniforms;
  const ndc = demonScreenNDC();
  let x = (ndc.x + 1) / 2 * S.W, y = (ndc.y + 1) / 2 * S.H;
  const cfg = SURF_CFG[D.surf || 'floor'];
  // entrance: it first shows up crawling in from the screen edge on its surface's side (top for ceiling/wall, bottom for
  // floor), pauses, then creeps to its world anchor (which may be off-screen: follow it by tilting up/down).
  const et = tt - (D.enterT ?? -99);
  if (et < 4.2) {
    const ex = Math.max(w * 0.30, Math.min(S.W - w * 0.30 - 70, (D.side || -1) < 0 ? S.W * 0.30 : S.W * 0.62));
    const ey = D.surf === 'floor' ? Math.max(170, h * 0.42) : S.H - h * 0.36;
    const edgeY = D.surf === 'floor' ? -h * 0.6 : S.H + h * 0.6;
    const k1 = Math.min(1, et / 1.1), e1 = 1 - Math.pow(1 - k1, 3);                       // crawl in from the edge
    const k2 = Math.max(0, Math.min(1, (et - 2.0) / 2.2)), e2 = k2 * k2 * (3 - 2 * k2);    // hold, then creep to the anchor
    const ix = ex, iy = edgeY + (ey - edgeY) * e1;
    const cx = Math.max(-w, Math.min(S.W + w, x)), cy = Math.max(-h * 1.2, Math.min(S.H + h * 1.2, y));
    x = ix + (cx - ix) * e2; y = iy + (cy - iy) * e2;
    D.vis = true;
  } else D.vis = ndc.on && x > -w && x < S.W + w && y > -h && y < S.H + h;
  // menacing idle: slow heaving breath, head tilt, creeping lean, limb flex, eye flicker
  const breath = Math.pow(0.5 + 0.5 * Math.sin(tt * 0.75), 1.6) * 2 - 1;
  let tilt = 0.09 * Math.sin(tt * 0.31) + 0.04 * Math.sin(tt * 0.83 + 1.3);
  const lean = 1 + 0.055 * (0.5 + 0.5 * Math.sin(tt * 0.23)) ** 3;          // slowly leans in, then back
  let flex = Math.sin(tt * 0.9) * 0.8 + Math.sin(tt * 2.3) * 0.2, stepv = Math.sin(tt * 0.6), jaw = 0;
  let eye = 0.25 + 0.35 * Math.abs(Math.sin(tt * 13.0) * Math.sin(tt * 7.3)) + (Math.random() < 0.03 ? 0.6 : 0);
  let rot = 0, ox = 0, oy = 0, sx = lean, sy = lean, flick = 0, glitch = 0;
  // occasional sudden twitch / jerk
  if (tt > D.twitchAt) { D.twitchT = tt; D.twitchDir = Math.random() < 0.5 ? -1 : 1; D.twitchAt = tt + rnd(2.5, 6.5); }
  const tw = tt - D.twitchT;
  if (tw < 0.22) { const k = 1 - tw / 0.22; rot += 0.06 * D.twitchDir * k; tilt += 0.28 * D.twitchDir * k; ox += 9 * D.twitchDir * k; flex += 1.2 * k; }
  // rare glitch-stutter
  if (tt > D.glitchAt) { D.glitchT = tt; D.glitchAt = tt + rnd(7, 15); }
  const gl = tt - D.glitchT;
  if (gl < 0.24) { glitch = 1; if (Math.floor(gl * 30) % 2) { ox += rnd(-14, 14); oy += rnd(-6, 6); } }
  // laugh at the 25% wall: much more intense
  const lt = tt - D.laughStart, laughing = lt >= 0 && lt < D.laughDur + 0.3;
  if (laughing) {
    const fall = 1 - Math.min(1, lt / (D.laughDur + 0.3));
    ox += rnd(-1, 1) * 12 * fall; oy += rnd(-1, 1) * 10 * fall;
    jaw = Math.abs(Math.sin(lt * 31)) * fall; sy *= 1 + 0.07 * jaw; sx *= 1 - 0.02 * jaw;
    rot += rnd(-0.05, 0.05) * fall; tilt += Math.sin(lt * 9) * 0.15 * fall; flex = Math.sin(lt * 14) * 1.6 * fall + flex * (1 - fall);
    flick = (Math.floor(lt * 11) % 3 === 0 ? 0.75 : 0.0) * fall; eye = 1.4 * fall + eye;
    u.uFlickCol.value.set(...(Math.floor(lt * 11) % 2 ? [1, 0.12, 0.12] : [0.55, 0.8, 1.0]));
    if (Math.random() < 0.08 * fall) glitch = 1;
  }
  demonMesh.visible = true;
  // cling to the surface: upside-down on the ceiling, sideways on the wall, crouched on the floor
  const srot = cfg.rot * (D.surf === 'wall' ? (D.side || -1) : 1);
  demonMesh.position.set(x + ox, y + oy, 0); demonMesh.scale.set(w * sx, h * sy * cfg.sq, 1); demonMesh.rotation.z = rot + srot;
  u.uPersp.value = cfg.persp;
  if (D.surf === 'floor') {
    shadowMesh.visible = true; shadowMesh.position.set(x + ox * 0.5, y - h * cfg.sq * 0.47, 0); shadowMesh.scale.set(w * 0.85, h * 0.16, 1);
  } else shadowMesh.visible = false;
  u.uTime.value = tt; u.uBreath.value = breath; u.uTilt.value = tilt; u.uFlex.value = flex; u.uStep.value = stepv; u.uJaw.value = jaw;
  u.uGlitch.value = glitch; u.uEye.value = eye; u.uFlick.value = flick;
  u.uOpacity.value = D.vis ? Math.min(MAXV, D.value) / 100 * OPACITY_SCALE : 0; S.demonOpacity = u.uOpacity.value;
  shadowMesh.material.opacity = Math.min(0.32, u.uOpacity.value * 2.6);   // slider shows 25 % max -> demon renders at 12.5 %
  S.demonPos = [Math.round(x), Math.round(y)];
  // caption: shown while the line is spoken, left of the slider/icon column
  const ct = tt - D.capT;
  if (ct >= 0 && ct < D.capDur && D.capText) {
    const px = (S.W - 130) / 2 + 4;
    const py = Math.max(260, S.H * 0.40);   // fixed: upper-middle, clear of the flash button and bottom controls
    capMesh.position.set(px, py, 0); capMesh.visible = true;
    const fade = Math.min(1, ct / 0.2) * (1 - Math.max(0, (ct - (D.capDur - 0.5)) / 0.5));
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
  track.addEventListener('touchstart', () => unlockAudio(), { passive: true });
  track.addEventListener('pointermove', e => { if (drag) { e.preventDefault(); sliderInput(rawFrom(e)); } });
  const end = () => { if (drag) { drag = false; D.armed = true; } };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  window.__lensSlider = sliderInput;   // test hook
})();
async function selectDemon(i) {
  unlockAudio();
  const btns = document.querySelectorAll('#demonBar button');
  if (D.sel === i) {                               // tap again: remove
    D.sel = 0; demonMesh.visible = false; capMesh.visible = false; shadowMesh.visible = false; D.anchor = null;
    btns.forEach(b => b.classList.remove('sel')); $('#demonSlider').classList.add('hidden'); return;
  }
  D.sel = i; btns.forEach(b => b.classList.toggle('sel', +b.dataset.i === i));
  D.value = 10; D.armed = true; D.capT = -10; D.idx = 0; D.prompted = false; renderSlider();
  $('#demonSlider').classList.remove('hidden');
  anchorDemon(); preloadVoice(i);
  try { const tex = await loadDemonTex(i); if (D.sel !== i) return; demonMat.uniforms.map.value = tex; placeDemon(tex); demonMesh.visible = true; }
  catch (e) { console.warn('demon load failed', e); }
}
(() => {
  const bar = $('#demonBar');
  for (let i = 1; i <= 10; i++) {
    const b = document.createElement('button'); b.dataset.i = i; b.setAttribute('aria-label', 'Demon ' + i);
    b.innerHTML = `<img src="demons/t${i}.png?v=6" alt="" draggable="false">`;
    b.addEventListener('click', e => { e.preventDefault(); selectDemon(i); });
    bar.appendChild(b);
  }
})();

async function begin(withCam) {
  $('#start').classList.add('hidden'); $('#ui').classList.remove('hidden'); $('#flashBtn').classList.remove('hidden');
  if (withCam) initTracking(); else setStatus('✦ demo mode (no camera)', true);
}
$('#startBtn').onclick = async () => {
  $('#startErr').classList.add('hidden');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser can’t open the camera here. Open the link in Safari (not inside the X app).');
    requestOrientation(); unlockAudio();
    await startCamera('user');
    begin(true);
  } catch (e) {
    const msg = e && e.name === 'NotAllowedError' ? 'Camera access was blocked. On iPhone: Settings → Safari → Camera → Allow, then reload this page.' : (e.message || String(e));
    const el = $('#startErr'); el.textContent = msg; el.classList.remove('hidden'); $('#demoBtn').classList.remove('hidden');
  }
};
$('#demoBtn').onclick = () => { requestOrientation(); unlockAudio(); begin(false); };

resize();
renderFlashUI();
document.fonts && document.fonts.load('40px Creepster').catch(() => {});
document.fonts && document.fonts.load('italic 500 33px "Cormorant Garamond"').finally(buildWatermark);
if (!document.fonts) buildWatermark();
frame();
