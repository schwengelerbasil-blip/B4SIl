// One persistent WebGL2 scene: the vinyl record + the assembling B4SIL lettering.
// Pose of the record is driven by scroll position, pointer and playback — no per-section copies.

import { perspective, multiply, translation, scaling, rotX, rotY, rotZ, mat3From4, clamp, easeOutExpo, easeInOutCubic } from './mat.js';

const FOV = (32 * Math.PI) / 180;
const CAM_Z = 10;
const HV = 2 * CAM_Z * Math.tan(FOV / 2); // visible world height at z = 0

const BLUE = '#72EAFF'; // Pool Blue
const PINK = '#FF5276'; // Bubblegum Pink
const INK = '#182544'; // Arcade Ink

/* ------------------------------------------------------------------ shaders */

const DISC_VS = `#version 300 es
in vec3 aPos; in vec3 aNrm; in float aKind;
uniform mat4 uVP; uniform mat4 uModel; uniform mat3 uRot;
out vec3 vWorld; out vec3 vNrm; out vec3 vObj; flat out float vKind;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz; vNrm = uRot * aNrm; vObj = aPos; vKind = aKind;
  gl_Position = uVP * w;
}`;

const DISC_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNrm; in vec3 vObj; flat in float vKind;
uniform vec3 uCam; uniform mat3 uRot; uniform sampler2D uLabel;
uniform vec3 uBlue; uniform vec3 uPink; uniform float uKey; uniform float uAcc;
uniform vec2 uLs; uniform float uOpacity;
out vec4 outColor;

float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }

// A rectangular studio softbox as seen in a reflection.
float softbox(vec3 R, vec3 C, float hw, float hh, float soft){
  float d = dot(R, C);
  if (d <= 0.0) return 0.0;
  vec3 U = normalize(vec3(0.0, 1.0, 0.0) - C * C.y);
  vec3 Rt = cross(U, C);
  vec2 p = vec2(dot(R, Rt), dot(R, U)) / d;
  vec2 q = abs(p) - vec2(hw, hh);
  float e = max(q.x, q.y);
  return 1.0 - smoothstep(-soft, soft, e);
}

vec3 envMap(vec3 R, vec3 keyCol){
  float up = R.y * 0.5 + 0.5;
  vec3 col = mix(vec3(0.004, 0.007, 0.016), uBlue * 0.035, smoothstep(0.3, 1.0, up));
  vec3 c1 = normalize(vec3(-0.55 + uLs.x, 0.62 + uLs.y, 0.56));
  vec3 c2 = normalize(vec3(0.78 + uLs.x, -0.08, 0.55));
  vec3 c3 = normalize(vec3(0.0, 0.95, 0.22));
  vec3 c4 = normalize(vec3(0.62, -0.7, 0.4));
  col += keyCol * uKey * 2.1 * softbox(R, c1, 0.32, 0.6, 0.05);
  col += keyCol * uKey * 1.3 * softbox(R, c2, 0.085, 0.85, 0.04);
  col += uBlue * uKey * 0.55 * softbox(R, c3, 0.95, 0.1, 0.06);
  col += uPink * uAcc * 0.9 * softbox(R, c4, 0.05, 0.5, 0.04);
  return col;
}

void main(){
  float r = length(vObj.xy);
  if (vKind < 1.5 && r < 0.0235) discard;

  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCam - vWorld);
  vec3 keyCol = mix(vec3(1.0), uBlue, 0.26);
  vec3 L1 = normalize(vec3(-0.55 + uLs.x, 0.62 + uLs.y, 0.56));
  vec3 L2 = normalize(vec3(0.78 + uLs.x, -0.08, 0.55));
  vec3 L3 = normalize(vec3(0.62, -0.7, 0.4));
  vec3 H1 = normalize(L1 + V);
  vec3 H2 = normalize(L2 + V);
  vec3 H3 = normalize(L3 + V);
  vec3 C1 = keyCol * uKey;
  vec3 C2 = keyCol * uKey * 0.55;
  vec3 C3 = uPink * uAcc * 0.5;
  float NV = max(dot(N, V), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - NV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 col;

  if (vKind > 1.5) {
    // edge of the record and the spindle wall: smooth black PVC
    float s1 = pow(max(dot(N, H1), 0.0), 60.0);
    float s2 = pow(max(dot(N, H2), 0.0), 60.0);
    col = vec3(0.008, 0.010, 0.016) + C1 * s1 * 0.7 + C2 * s2 * 0.6 + envMap(R, keyCol) * (0.1 + fres * 1.2);
  } else if (r < 0.3285) {
    // centre label: matte printed paper
    vec2 uv = vObj.xy / 0.657 + 0.5;
    vec3 tex = lin(texture(uLabel, uv).rgb);
    float fibre = hash2(floor(vObj.xy * 760.0)) - 0.5;
    float nl1 = max(dot(N, L1), 0.0);
    float nl2 = max(dot(N, L2), 0.0);
    vec3 diff = tex * (0.2 + 0.85 * (C1 * nl1 + C2 * nl2)) * (1.0 + 0.05 * fibre);
    float broad = pow(max(dot(N, H1), 0.0), 22.0) * 0.045 * uKey;
    col = diff + keyCol * broad + envMap(R, keyCol) * fres * 0.25;
  } else {
    // vinyl: raised rings, grooves, track gaps, dead wax
    float gz = smoothstep(0.372, 0.384, r) * (1.0 - smoothstep(0.958, 0.968, r));
    float gap = 0.0;
    float gaps[5] = float[5](0.50, 0.605, 0.71, 0.82, 0.915);
    for (int i = 0; i < 5; i++) gap += 1.0 - smoothstep(0.0, 0.0055, abs(r - gaps[i]) - 0.0035);
    gap = clamp(gap, 0.0, 1.0) * gz;

    float phase = r * 3000.0;
    float aa = 1.0 - smoothstep(0.55, 1.6, fwidth(phase));
    float gv = 0.5 + 0.5 * sin(phase);
    float gn = hash(floor(r * 1500.0));
    float mod_ = 1.0 + aa * (0.2 * (gv - 0.5) + 0.3 * (gn - 0.5));

    vec3 T = normalize(uRot * vec3(-vObj.y, vObj.x, 0.0));
    float st1 = sqrt(max(0.0, 1.0 - pow(dot(T, H1), 2.0)));
    float st2 = sqrt(max(0.0, 1.0 - pow(dot(T, H2), 2.0)));
    float st3 = sqrt(max(0.0, 1.0 - pow(dot(T, H3), 2.0)));
    float g1 = smoothstep(-0.05, 0.25, dot(N, L1));
    float g2 = smoothstep(-0.05, 0.25, dot(N, L2));
    float g3 = smoothstep(-0.05, 0.25, dot(N, L3));
    vec3 aniso = C1 * (pow(st1, 230.0) * 0.8 + pow(st1, 26.0) * 0.03) * g1
               + C2 * (pow(st2, 230.0) * 0.8 + pow(st2, 26.0) * 0.025) * g2
               + C3 * (pow(st3, 200.0) * 0.7) * g3;
    aniso *= mod_ * (1.0 - gap) * gz;

    vec3 base = vec3(0.010, 0.0115, 0.018) * mod_;
    vec3 diff = base * (0.55 + 0.6 * (C1 * max(dot(N, L1), 0.0) + C2 * max(dot(N, L2), 0.0)));
    float smoothness = clamp(gap + (1.0 - gz), 0.0, 1.0);
    vec3 envc = envMap(R, keyCol) * (0.035 + 0.55 * smoothness) * (0.3 + fres * 2.2);
    col = diff + aniso + envc;

    // soft contact darkening beside the raised label ring and the outer lip
    float ao = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.03, abs(r - 0.372))) * step(0.34, r);
    col *= ao;

    float lip = (1.0 - smoothstep(0.0, 0.003, abs(r - 0.377) - 0.001)) + (1.0 - smoothstep(0.0, 0.003, abs(r - 0.963) - 0.001));
    col += keyCol * uKey * 0.035 * lip * NV;
  }

  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(col, vec3(1.0 / 2.2));
  outColor = vec4(col * uOpacity, uOpacity);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform float uAlpha; out vec4 outColor;
void main(){
  float d = length(vUv * 2.0 - 1.0);
  float a = (1.0 - smoothstep(0.55, 1.0, d)) * uAlpha;
  outColor = vec4(vec3(0.015, 0.03, 0.07) * a, a);
}`;

const LET_VS = `#version 300 es
in vec2 aPos; uniform mat4 uMVP; out vec2 vUv;
void main(){ vUv = aPos + 0.5; gl_Position = uMVP * vec4(aPos, 0.0, 1.0); }`;

const LET_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uTex; uniform vec2 uPx;
uniform vec3 uBlue; uniform vec3 uPink; uniform float uAlpha; uniform float uTint; uniform vec2 uLs;
out vec4 outColor;
float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
void main(){
  float a = texture(uTex, vUv).a;
  vec2 d = uPx * 3.0;
  float aL = texture(uTex, vUv - vec2(d.x, 0.0)).a;
  float aR = texture(uTex, vUv + vec2(d.x, 0.0)).a;
  float aD = texture(uTex, vUv - vec2(0.0, d.y)).a;
  float aU = texture(uTex, vUv + vec2(0.0, d.y)).a;
  vec2 g = vec2(aR - aL, aU - aD);
  vec3 n = normalize(vec3(-g * 1.7, 0.55));
  vec3 l = normalize(vec3(-0.5 + uLs.x, 0.6 + uLs.y, 0.6));
  float lit = max(dot(n, l), 0.0);
  float brush = 0.85 + 0.15 * hash(floor(vUv.y * 720.0));
  vec3 tint = mix(uBlue, uPink, uTint);
  vec3 metal = tint * (0.3 + 0.45 * vUv.y) * brush;
  float edge = clamp(length(g) * 2.2, 0.0, 1.0);
  vec3 col = metal * (0.5 + 0.9 * lit) + tint * edge * 0.4;
  float cov = clamp(a + edge * 0.1, 0.0, 1.0);
  outColor = vec4(col * cov * uAlpha, cov * uAlpha);
}`;

/* ------------------------------------------------------------------ helpers */

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/**
 * The record is a revolved profile (radius 1): raised outer lip with a rounded edge,
 * thin groove field, raised ring around the label, slightly recessed label, spindle wall.
 */
function discGeometry(seg = 256) {
  const profile = [
    [0.024, 0.0055], [0.3285, 0.0055], [0.336, 0.0078], [0.362, 0.0078], [0.37, 0.0044],
    [0.964, 0.0044], [0.972, 0.0074], [0.99, 0.0076], [0.996, 0.0066], [0.9995, 0.0045], [1.0, 0.0],
  ];
  const v = [];
  const idx = [];
  const ring = (r, z, nr, nz, kind) => {
    const first = v.length / 7;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      v.push(r * c, r * s, z, nr * c, nr * s, nz, kind);
    }
    return first;
  };
  const strip = (a, b) => {
    for (let i = 0; i < seg; i++) idx.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1);
  };

  for (const top of [true, false]) {
    const s = top ? 1 : -1;
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, h0] = profile[i];
      const [r1, h1] = profile[i + 1];
      const dr = r1 - r0;
      const dh = h1 - h0;
      let nr = -dh, nz = dr;
      const l = Math.hypot(nr, nz);
      nr /= l; nz = (nz / l) * s;
      const kind = Math.abs(dh) > dr * 1.2 ? 2 : top ? 0 : 1;
      strip(ring(r0, s * h0, nr, nz, kind), ring(r1, s * h1, nr, nz, kind));
    }
  }
  // spindle hole wall
  const hz = profile[0][1];
  strip(ring(0.024, hz, -1, 0, 2), ring(0.024, -hz, -1, 0, 2));
  return { vertices: new Float32Array(v), indices: new Uint16Array(idx) };
}

function srgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const toLinear = (c) => c.map((v) => Math.pow(v, 2.2));

function loadFont(family) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const timeout = new Promise((r) => setTimeout(r, 2200));
  return Promise.race([Promise.all([document.fonts.load(`400 120px ${family}`), document.fonts.load(`700 120px ${family}`)]).catch(() => {}), timeout]);
}

function makeLabelCanvas(family) {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;

  // paper: Arcade Ink, very slightly lit from the upper left
  const grad = g.createRadialGradient(S * 0.38, S * 0.34, S * 0.05, cx, cx, S * 0.56);
  grad.addColorStop(0, '#22345f');
  grad.addColorStop(1, '#16213d');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  // paper grain
  for (let i = 0; i < 60000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.045})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
  }

  const blue = 'rgba(114,234,255,0.92)';
  const soft = 'rgba(114,234,255,0.55)';

  // fine print rings
  g.strokeStyle = soft;
  g.lineWidth = 1.5;
  for (const r of [498, 410, 392]) { g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke(); }

  // ring text
  g.fillStyle = blue;
  g.font = `400 27px ${family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ring = 'B4SIL  ·  MIX & MASTERING  ·  B4SIL  ·  MIX & MASTERING  ·  ';
  const radius = 452;
  const step = (Math.PI * 2) / ring.length;
  for (let i = 0; i < ring.length; i++) {
    g.save();
    g.translate(cx, cx);
    g.rotate(i * step - Math.PI / 2);
    g.fillText(ring[i], 0, -radius);
    g.restore();
  }

  // centre type (kept clear of the spindle hole)
  g.fillStyle = '#f1f4fa';
  g.font = `700 128px ${family}`;
  const w = g.measureText('B4SIL').width;
  const x0 = cx - w / 2;
  g.textAlign = 'left';
  const parts = ['B', '4', 'SIL'];
  let x = x0;
  for (const p of parts) {
    g.fillStyle = p === '4' ? PINK : '#f1f4fa';
    g.fillText(p, x, cx - 165);
    x += g.measureText(p).width;
  }
  g.textAlign = 'center';
  g.fillStyle = blue;
  g.font = `700 32px ${family}`;
  g.fillText('MIX & MASTERING', cx, cx + 152);
  g.fillStyle = 'rgba(241,244,250,0.62)';
  g.font = `400 26px ${family}`;
  g.fillText('SIDE A  ·  33⅓ RPM', cx, cx + 200);

  // the single pink detail: a ring around the spindle
  g.strokeStyle = PINK;
  g.lineWidth = 9;
  g.beginPath(); g.arc(cx, cx, 68, 0, Math.PI * 2); g.stroke();
  return c;
}

const LETTERS = ['B', '4', 'S', 'I', 'L'];
// where each letter starts (screen-space offsets as a fraction of view, plus depth + rotation)
const LETTER_START = [
  { dx: -0.55, dy: 0.34, dz: -6, rx: 0.9, ry: -1.1, rz: -0.45 },
  { dx: -0.2, dy: -0.46, dz: -4, rx: -0.8, ry: 0.9, rz: 0.5 },
  { dx: 0.12, dy: 0.5, dz: -7, rx: 1.1, ry: 0.7, rz: -0.3 },
  { dx: 0.4, dy: -0.38, dz: -5, rx: -0.9, ry: -0.9, rz: 0.6 },
  { dx: 0.62, dy: 0.3, dz: -6.5, rx: 0.7, ry: 1.2, rz: 0.4 },
];
const LETTER_DEPTH = [-0.9, -1.5, -0.7, -1.3, -1.0];

function makeLetters(family) {
  const fs = 300;
  const pad = 36;
  const out = [];
  const m = document.createElement('canvas').getContext('2d');
  m.font = `400 ${fs}px ${family}`;
  for (const ch of LETTERS) {
    const adv = m.measureText(ch).width - fs * 0.04; // tight tracking
    const w = Math.ceil(adv + pad * 2);
    const h = Math.ceil(fs * 1.25);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.font = `400 ${fs}px ${family}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    g.fillText(ch, w / 2, fs * 1.0);
    out.push({ canvas: c, w, h, adv });
  }
  return out;
}

/* ------------------------------------------------------------------ keyframes */
// channels: x, y (fraction of half view), z (world), d (diameter / unit), rx, ry, rz, key light, pink accent
const KEYS_WIDE = [
  [0.5, 0.0, 0.0, 0.94, -0.38, 0.3, -0.22, 1.0, 0.7], // hero
  [-0.62, 0.04, -1.2, 0.76, -1.02, 0.5, -0.18, 1.0, 0.5], // services
  [0.7, -0.12, 1.2, 1.12, -1.28, -0.85, 0.6, 0.85, 0.7], // studio
  [0.0, -0.98, -1.6, 0.95, -1.2, 0.0, 0.1, 0.9, 0.6], // before / after
  [0.0, -0.98, 0.6, 1.25, -1.02, 0.0, 0.0, 0.75, 0.8], // contact
];
const KEYS_TALL = [
  [0.16, 0.36, 0.0, 0.95, -0.4, 0.3, -0.22, 1.0, 0.7],
  [0.55, 0.6, -1.0, 0.8, -1.0, 0.5, -0.2, 1.0, 0.5],
  [-0.5, -0.45, 0.4, 1.0, -1.25, -0.8, 0.6, 0.85, 0.7],
  [0.0, 0.9, -1.8, 0.8, -1.15, 0.05, 0.12, 0.9, 0.6],
  [0.0, -0.95, 0.4, 1.6, -1.02, 0.0, 0.0, 0.75, 0.8],
];

function samplePose(keys, stops, s, out) {
  const n = keys.length;
  if (s <= stops[0]) { for (let c = 0; c < out.length; c++) out[c] = keys[0][c]; return out; }
  if (s >= stops[n - 1]) { for (let c = 0; c < out.length; c++) out[c] = keys[n - 1][c]; return out; }
  let i = 0;
  while (i < n - 2 && s >= stops[i + 1]) i++;
  const h = stops[i + 1] - stops[i];
  const t = (s - stops[i]) / h;
  const t2 = t * t, t3 = t2 * t;
  const k = 0.75; // tangent scale (less overshoot)
  for (let c = 0; c < out.length; c++) {
    const p0 = keys[i][c], p1 = keys[i + 1][c];
    const m0 = (i > 0 ? (p1 - keys[i - 1][c]) / (stops[i + 1] - stops[i - 1]) : (p1 - p0) / h) * k;
    const m1 = (i + 2 < n ? (keys[i + 2][c] - p0) / (stops[i + 2] - stops[i]) : (p1 - p0) / h) * k;
    out[c] = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * h * m1;
  }
  return out;
}

/* ------------------------------------------------------------------ scene */

export async function createScene(canvas, onFallback) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;

  const family = '"Instrument Sans", system-ui, sans-serif';
  await loadFont('"Instrument Sans"');

  const BLUE_S = srgb(BLUE);
  const PINK_S = srgb(PINK);
  const BLUE_L = toLinear(BLUE_S);
  const PINK_L = toLinear(PINK_S);

  let res = null;
  let dpr = Math.min(window.devicePixelRatio || 1, window.matchMedia('(max-width: 900px)').matches ? 1.5 : 1.75);
  let width = 0, height = 0, aspect = 1;
  let proj = null;
  let spin = 0;
  let playBoost = 0;
  let playTarget = 0;
  let slow = 0, slowN = 0;
  const pose = new Float32Array(9);
  let layout = null;

  window.addEventListener('b4sil:playing', (e) => { playTarget = e.detail ? 1 : 0; });

  function build() {
    const disc = program(gl, DISC_VS, DISC_FS);
    const let_ = program(gl, LET_VS, LET_FS);
    const shadow = program(gl, LET_VS, SHADOW_FS);

    const geo = discGeometry();
    const discVao = gl.createVertexArray();
    gl.bindVertexArray(discVao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.STATIC_DRAW);
    const stride = 7 * 4;
    const locs = ['aPos', 'aNrm', 'aKind'].map((n) => gl.getAttribLocation(disc.p, n));
    gl.enableVertexAttribArray(locs[0]); gl.vertexAttribPointer(locs[0], 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(locs[1]); gl.vertexAttribPointer(locs[1], 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(locs[2]); gl.vertexAttribPointer(locs[2], 1, gl.FLOAT, false, stride, 24);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);

    const quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    const ql = gl.getAttribLocation(let_.p, 'aPos');
    gl.enableVertexAttribArray(ql); gl.vertexAttribPointer(ql, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const tex = (canvasEl) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasEl);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    };

    const label = tex(makeLabelCanvas(family));
    const letters = makeLetters(family).map((l) => ({ ...l, tex: tex(l.canvas) }));
    res = { disc, let_, shadow, discVao, quadVao, indexCount: geo.indices.length, label, letters };
    layout = null;
  }

  function layoutLetters() {
    const L = res.letters;
    const Wv = HV * aspect;
    const portrait = aspect < 0.8;
    const rows = portrait ? [[0, 1], [2, 3, 4]] : [[0, 1, 2, 3, 4]];
    const items = new Array(L.length);
    const frac = portrait ? 0.94 : 0.9;
    let widest = 0;
    for (const row of rows) widest = Math.max(widest, row.reduce((a, i) => a + L[i].adv, 0));
    const scale = (frac * Wv) / widest;
    const fs = 300;
    const capH = 0.7 * fs * scale;
    const rowGap = capH * 1.28;
    const yCenter = portrait ? -0.02 * HV : -0.015 * HV;
    rows.forEach((row, ri) => {
      const total = row.reduce((a, i) => a + L[i].adv, 0) * scale;
      let x = -total / 2;
      const y = yCenter + ((rows.length - 1) / 2 - ri) * rowGap;
      for (const i of row) {
        const w = L[i].adv * scale;
        items[i] = { x: x + w / 2, y: y, w: L[i].w * scale, h: L[i].h * scale };
        x += w;
      }
    });
    layout = items;
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    width = Math.max(2, Math.floor(w * dpr));
    height = Math.max(2, Math.floor(h * dpr));
    canvas.width = width;
    canvas.height = height;
    aspect = w / h;
    proj = perspective(FOV, aspect, 0.1, 60);
    layout = null;
  }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onFallback && onFallback(true); });
  canvas.addEventListener('webglcontextrestored', () => { build(); resize(); onFallback && onFallback(false); });

  build();
  resize();
  window.addEventListener('resize', resize);

  const view = translation(0, 0, -CAM_Z);

  /** Called every frame by main.js. */
  function render(dt, time, S) {
    slow += dt; slowN++;
    if (slowN >= 90) {
      const avg = slow / slowN;
      if (avg > 0.024 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); resize(); }
      slow = 0; slowN = 0;
    }

    const portrait = aspect < 0.8;
    const Wv = HV * aspect;
    const U = portrait ? Math.min(HV, Wv * 1.15) : HV;

    const intro = easeOutExpo(clamp((time - 0.2) / 3.0));
    const sy = S.y;
    const stops = S.stops;

    samplePose(portrait ? KEYS_TALL : KEYS_WIDE, stops, sy, pose);

    const px = S.px, py = S.py;
    let [kx, ky, kz, kd, rx, ry, rz, keyI, accI] = pose;
    rx += 0.05 * Math.sin(sy * 0.0021) + py * 0.1;
    ry += 0.06 * Math.sin(sy * 0.0017 + 1.0) + px * 0.16;
    rz += 0.04 * Math.sin(sy * 0.0013 + 2.0);
    kx += 0.02 * Math.sin(sy * 0.0025) + px * 0.025;
    ky += py * -0.02;

    kz -= (1 - intro) * 7;
    ry += (1 - intro) * 2.2;
    rz -= (1 - intro) * 0.6;
    const opacity = clamp(intro * 1.7);

    playBoost += (playTarget - playBoost) * (1 - Math.exp(-dt * 2.2));
    spin += dt * (0.32 + playBoost * 1.9) + S.dy * 0.0035;

    const persp = (CAM_Z - kz) / CAM_Z;
    const wx = kx * (Wv / 2) * persp;
    const wy = ky * (HV / 2) * persp;
    const radius = (kd * U) / 2;

    const R = multiply(rotZ(rz), multiply(rotY(ry), multiply(rotX(rx), rotZ(spin))));
    const Rtilt = multiply(rotZ(rz), multiply(rotY(ry), rotX(rx)));
    const model = multiply(translation(wx, wy, kz), multiply(R, scaling(radius, radius, radius)));
    const rot3 = mat3From4(R);
    const vp = multiply(proj, view);

    const lsx = px * 0.22 + Math.sin(sy * 0.0011) * 0.14;
    const lsy = py * -0.18;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    /* ---- B4SIL lettering (behind everything) ---- */
    if (!layout) layoutLetters();
    gl.useProgram(res.let_.p);
    gl.bindVertexArray(res.quadVao);
    const lu = res.let_.u;
    gl.uniform3fv(lu.uBlue, BLUE_S);
    gl.uniform3fv(lu.uPink, PINK_S);
    gl.uniform2f(lu.uLs, lsx, lsy);
    const complete = clamp(sy / Math.max(1, stops[3]));
    for (let i = 0; i < LETTERS.length; i++) {
      const it = layout[i];
      const st = LETTER_START[i];
      const a = easeInOutCubic(clamp((complete * 1.18 - i * 0.075) / 0.6));
      const inv = 1 - a;
      const zf = LETTER_DEPTH[i];
      const z = zf + st.dz * inv;
      const sxp = it.x + st.dx * Wv * inv + px * 0.12 * (1 + zf * -0.3) * (0.4 + 0.6 * a);
      const syp = it.y + st.dy * HV * inv + py * -0.08 * (1 + zf * -0.3) * (0.4 + 0.6 * a);
      const pz = (CAM_Z - z) / CAM_Z;
      const fz = (CAM_Z - zf) / CAM_Z;
      const m = multiply(
        translation(sxp * pz, syp * pz, z),
        multiply(rotZ(st.rz * inv), multiply(rotY(st.ry * inv), multiply(rotX(st.rx * inv), scaling(it.w * fz, it.h * fz, 1))))
      );
      gl.uniformMatrix4fv(lu.uMVP, false, multiply(vp, m));
      gl.uniform2f(lu.uPx, 1 / res.letters[i].w, 1 / res.letters[i].h);
      gl.uniform1f(lu.uTint, i === 1 ? 1 : 0);
      gl.uniform1f(lu.uAlpha, (0.1 + 0.9 * a) * 0.2 * intro);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.letters[i].tex);
      gl.uniform1i(lu.uTex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /* ---- soft drop shadow: the record's silhouette, offset away from the key light ---- */
    gl.useProgram(res.shadow.p);
    gl.bindVertexArray(res.quadVao);
    const sm = multiply(
      translation(wx + radius * 0.07, wy - radius * 0.1, kz - 0.4),
      multiply(Rtilt, scaling(radius * 2.5, radius * 2.5, 1))
    );
    gl.uniformMatrix4fv(res.shadow.u.uMVP, false, multiply(vp, sm));
    gl.uniform1f(res.shadow.u.uAlpha, 0.5 * opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    /* ---- the record ---- */
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(res.disc.p);
    gl.bindVertexArray(res.discVao);
    const du = res.disc.u;
    gl.uniformMatrix4fv(du.uVP, false, vp);
    gl.uniformMatrix4fv(du.uModel, false, model);
    gl.uniformMatrix3fv(du.uRot, false, rot3);
    gl.uniform3f(du.uCam, 0, 0, CAM_Z);
    gl.uniform3fv(du.uBlue, BLUE_L);
    gl.uniform3fv(du.uPink, PINK_L);
    gl.uniform1f(du.uKey, 0.62 * keyI);
    gl.uniform1f(du.uAcc, accI);
    gl.uniform2f(du.uLs, lsx, lsy);
    gl.uniform1f(du.uOpacity, opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.label);
    gl.uniform1i(du.uLabel, 0);
    gl.drawElements(gl.TRIANGLES, res.indexCount, gl.UNSIGNED_SHORT, 0);

    return { complete };
  }

  return { render, resize };
}
