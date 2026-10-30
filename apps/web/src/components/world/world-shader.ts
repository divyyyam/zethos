/**
 * The Zethos world: a painted mountain range rendered in a single fragment shader. Six ridgelines
 * are composited nearest-first, so most pixels stop after one or two noise evaluations. `uMorph`
 * collapses the near ridges into a stepped order-book depth curve, which is already a valley with
 * walls on either side; the lake in that valley is the "thin pool" the rest of the page talks about.
 */
export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uCam;      // camera height: raises the horizon out of frame so copy sits on open sky
uniform float uMorph;    // 0 ridgelines, 1 order-book depth curve
uniform float uNight;    // 0 sun, 1 moon and stars
uniform float uLake;     // 0 no water, 1 full lake
uniform vec2 uPointer;   // -1..1, smoothed
uniform vec2 uSunPos;
uniform vec3 uSkyTop, uSkyMid, uSkyLow, uFar, uNear, uSun, uBid, uAsk;

const int LAYERS = 6;
const float WATER = -0.335;

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise1(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), f);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x),
             mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise2(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
// Ridged 1D noise: sharp crests, the signature of a mountain silhouette.
float ridged(float x, int octaves) {
  float a = 0.56, s = 0.0, w = 1.0;
  for (int i = 0; i < octaves; i++) {
    float n = 1.0 - abs(2.0 * noise1(x) - 1.0);
    n *= n;
    s += a * n * w;
    w = clamp(n * 1.6, 0.25, 1.0);
    x = x * 2.13 + 11.7;
    a *= 0.5;
  }
  return s;
}

// Cumulative order-book depth at distance |x| from the mid price, quantised into price levels.
float rock(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * (1.0 - abs(2.0 * noise2(p) - 1.0));
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 9.2;
    a *= 0.5;
  }
  return s;
}

float depthCurve(float x) {
  float level = 0.046;
  float q = floor(abs(x) / level);
  float side = x < 0.0 ? 3.1 : 7.7;
  float tick = floor(uTime * 1.4);
  float settle = smoothstep(0.0, 0.5, fract(uTime * 1.4));
  float jitter = mix(hash1(q + side + tick), hash1(q + side + tick + 1.0), settle);
  float stepped = q * level;
  return 0.0 + pow(stepped, 1.22) * 0.56 + (hash1(q * 1.7 + side) * 0.03 + jitter * 0.012) * step(0.5, q);
}

float layerHeight(int i, float x, float time) {
  float fi = float(i);
  float t = fi / float(LAYERS - 1);                    // 0 far .. 1 near
  float freq = mix(1.25, 3.3, t);
  float base = mix(-0.075, -0.345, t);
  float amp = mix(0.40, 0.17, t);
  float par = mix(0.012, 0.075, t * t);
  float xs = (x + uPointer.x * par) * freq + fi * 19.37 + 3.0;
  int oct = i < 2 ? 6 : 5;
  float h = base + amp * ridged(xs, oct);
  if (i >= 4) {
    // Conifer treeline on the two nearest ridges.
    float tx = (x + uPointer.x * par) * 44.0 + fi * 9.1;
    float ti = floor(tx), tf = fract(tx);
    float treeH = 0.25 + 0.75 * hash1(ti + fi);
    float tri = 1.0 - abs(2.0 * tf - 1.0);
    h += tri * tri * treeH * mix(0.016, 0.03, t) * (0.5 + 0.5 * noise1(x * 3.0 + fi));
  }
  if (uMorph > 0.001) {
    // Near ridges become the book; each sits a level behind the next so the steps read as depth.
    float slot = fi - 3.0;
    float m = smoothstep(slot * 0.09, 0.55 + slot * 0.09, uMorph);
    float book = -0.335 + 0.012 * (2.0 - slot) + depthCurve(x * (1.0 + 0.07 * (2.0 - slot))) * (1.0 + 0.11 * (2.0 - slot));
    if (i < 3) h = mix(h, -0.8, smoothstep(0.0, 0.8, uMorph));
    else h = mix(h, book, m * m * (3.0 - 2.0 * m));
  }
  return h;
}

vec3 skyColor(vec2 p, float time) {
  float y = p.y;
  float g = smoothstep(-0.38, 0.62, y);
  vec3 col = mix(uSkyLow, uSkyMid, smoothstep(0.0, 0.45, g));
  col = mix(col, uSkyTop, smoothstep(0.35, 1.0, g));

  // Sun, or moon when uNight is high.
  vec2 d = p - uSunPos;
  // main() squeezes x on portrait screens; undo that here so the disc stays round.
  float aspect = uRes.x / uRes.y;
  if (aspect < 1.0) d.x /= mix(1.55, 1.0, aspect);
  float r = length(d);
  float disc = 1.0 - smoothstep(0.047, 0.052, r);
  col += uSun * (0.24 * exp(-r * 3.4) + 0.2 * exp(-r * 11.0)) * (1.0 - 0.7 * uNight);
  if (uNight > 0.5) {
    float crater = fbm2(d * 26.0 + 4.0);
    col = mix(col, uSun * (0.74 + 0.34 * crater), disc);
  } else {
    col = mix(col, mix(uSun, vec3(1.0), 0.86), disc);
  }

  // High cloud: two stretched sheets drifting in opposite directions.
  if (y > -0.2) {
    float c1 = fbm2(vec2(p.x * 1.5 + time * 0.012, y * 6.5 + 3.0) + 2.0 * fbm2(vec2(p.x * 0.7 - time * 0.006, y * 2.4)));
    float sheet = smoothstep(0.47, 0.82, c1) * smoothstep(-0.2, 0.08, y) * (1.0 - smoothstep(0.42, 0.72, y));
    vec3 lit = mix(mix(uSkyLow, vec3(1.0), 0.62), uSkyMid * 0.55 + uSun * 0.12, uNight);
    // Reading sections lift the camera; the sky goes quiet behind the copy.
    float calm = smoothstep(0.25, 0.65, uCam);
    col = mix(col, lit, sheet * mix(0.72, 0.32, uNight) * (1.0 - 0.85 * calm));
  }

  // Stars, and a faint band across the night sky.
  if (uNight > 0.01) {
    vec2 sp = p * 128.0;
    vec2 cell = floor(sp);
    float rnd = hash2(cell);
    if (rnd > 0.978) {
      vec2 off = vec2(hash2(cell + 3.0), hash2(cell + 9.0)) - 0.5;
      float dist = length(fract(sp) - 0.5 - off * 0.7);
      float tw = 0.65 + 0.35 * sin(time * (1.0 + rnd * 3.0) + rnd * 90.0);
      float mag = (rnd - 0.978) / 0.022;
      col += uNight * smoothstep(0.17 + mag * 0.13, 0.0, dist) * tw * (0.2 + 0.8 * mag) * vec3(0.9, 0.92, 1.0);
    }
    float band = exp(-pow((p.y - p.x * 0.34 - 0.2) * 3.6, 2.0));
    col += uNight * band * smoothstep(0.36, 0.72, fbm2(p * 4.0 + 8.0)) * vec3(0.10, 0.09, 0.2);
  }
  return col;
}

vec3 scene(vec2 p, float time) {
  for (int i = LAYERS - 1; i >= 0; i--) {
    float h = layerHeight(i, p.x, time);
    if (p.y > h) continue;
    float fi = float(i);
    float t = fi / float(LAYERS - 1);
    float depth = h - p.y;
    float slope = (layerHeight(i, p.x + 0.04, time) - layerHeight(i, p.x - 0.04, time)) / 0.08;

    vec3 base = mix(uFar, uNear, pow(t, 1.05));

    // Light the faces turned toward the sun; streaks follow the fall line of each slope.
    // Rock is a bump-lit field stretched along a diagonal, so it reads as strata rather than pits.
    float dir = p.x < uSunPos.x ? 1.0 : -1.0;
    vec2 q = vec2(p.x * 0.8 + dir * p.y * 0.6, p.y * 0.8 - dir * p.x * 0.6) * mix(vec2(3.0, 15.0), vec2(7.0, 30.0), t) + fi * 7.3;
    float e = 0.035;
    float r0 = rock(q), rx = rock(q + vec2(e, 0.0)), ry = rock(q + vec2(0.0, e));
    vec2 bump = vec2(rx - r0, ry - r0) / e;
    vec2 toSun = normalize(uSunPos - p + vec2(0.0, 0.25));
    float side = clamp(slope * sign(uSunPos.x - p.x) * 0.55, -1.0, 1.0) * smoothstep(0.32, 0.02, depth);
    float lit = clamp(dot(bump, toSun) * 0.3 * (1.0 - t * 0.6) + side * 0.26, -1.0, 1.0);
    float grain = r0;
    vec3 sunTint = mix(uSun, uFar, 0.3);
    base = mix(base, base * 0.62 + uNear * 0.14, clamp(-lit, 0.0, 1.0) * (1.0 - t * 0.5));
    base = mix(base, sunTint, clamp(lit, 0.0, 1.0) * mix(0.8, 0.12, t) * (1.0 - 0.3 * uNight));

    // Snow caps on the far range, breaking up with noise.
    if (i < 3) {
      float snowLine = smoothstep(0.075, 0.015, depth + (grain - 0.5) * 0.09) * smoothstep(0.03, 0.2, h);
      base = mix(base, mix(uSkyLow, vec3(1.0), 0.72 - 0.42 * uNight) * mix(1.0, 0.8, uNight), snowLine * (0.9 - t));
    }

    // Book colouring: bids left, asks right, with a lit edge along each level.
    if (i >= 3 && uMorph > 0.001) {
      float m = smoothstep(0.25, 0.85, uMorph);
      vec3 book = mix(uBid, uAsk, step(0.0, p.x));
      float shade = mix(0.42, 1.0, smoothstep(0.34, 0.0, depth));
      base = mix(base, book * shade * mix(0.72, 1.0, fi - 3.0 == 2.0 ? 1.0 : 0.5), m);
      base += book * smoothstep(0.0035, 0.0, depth) * m * 1.15;
    }

    // Aerial perspective: mist pools at the foot of each ridge.
    float mist = smoothstep(0.02, mix(0.34, 0.16, t), depth) * mix(0.8, 0.14, t * t) * (1.0 - uMorph * 0.8);
    base = mix(base, mix(uSkyLow, uFar, 0.28 + 0.42 * t), mist);
    return base;
  }
  return skyColor(p, time);
}

void main() {
  float time = uTime;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p.y += uCam;
  // Portrait screens would squash the range: zoom out horizontally.
  float aspect = uRes.x / uRes.y;
  if (aspect < 1.0) p.x *= mix(1.55, 1.0, aspect);
  p += uPointer * vec2(0.0, 0.004);

  vec3 col;
  float water = WATER;
  if (p.y < water && uLake > 0.001) {
    float dist = water - p.y;
    // Ripples compress toward the horizon, so frequency climbs as the water recedes.
    float persp = 1.0 / (dist * 7.0 + 0.045);
    float ripple = fbm2(vec2(p.x * 2.6 + time * 0.03, persp * 1.3 + time * 0.22)) - 0.5;
    float ripple2 = noise2(vec2(p.x * 5.0 - time * 0.05, persp * 3.1 - time * 0.35)) - 0.5;
    vec2 refl = vec2(p.x + (ripple + ripple2 * 0.5) * (0.012 + dist * 0.28), water + dist * 1.08);
    vec3 mirror = scene(refl, time);
    float fres = pow(1.0 - clamp(dist * 2.6, 0.0, 1.0), 2.0);
    vec3 deep = mix(uNear * 1.2, uSkyMid, 0.16);
    vec3 lake = mix(deep, mirror, 0.55 + 0.4 * fres);
    lake += (ripple2 * 0.05) * uSkyMid;

    // Glitter: thin horizontal glints gathered into a column under the sun or moon.
    float colX = abs(p.x - uSunPos.x + ripple * 0.05);
    float column = exp(-colX * colX * mix(150.0, 34.0, clamp(dist * 3.4, 0.0, 1.0)));
    float glint = noise2(vec2(p.x * 26.0 + ripple * 6.0, persp * 8.0 + time * 0.9));
    float spark = smoothstep(0.56, 0.86, glint);
    lake += uSun * column * (0.12 + spark * 0.95) * smoothstep(0.0, 0.012, dist) * (1.0 - 0.25 * uNight);

    // A hairline of light where the water meets the shore.
    lake += mix(uSkyLow, vec3(1.0), 0.4) * smoothstep(0.004, 0.0, dist) * 0.12;
    vec3 ground = scene(p, time);
    col = mix(ground, lake, uLake);
  } else {
    col = scene(p, time);
  }

  // Vignette and fine film grain; the grain also breaks up 8-bit banding in the sky.
  vec2 v = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - dot(v, v) * mix(0.16, 0.7, uNight);
  float grainV = hash2(gl_FragCoord.xy + fract(time) * 311.0) - 0.5;
  col += grainV * mix(0.018, 0.03, uNight);
  outColor = vec4(col, 1.0);
}`;

type Rgb = readonly [number, number, number];

export interface Palette {
  skyTop: Rgb;
  skyMid: Rgb;
  skyLow: Rgb;
  far: Rgb;
  near: Rgb;
  sun: Rgb;
  bid: Rgb;
  ask: Rgb;
  sunPos: readonly [number, number];
  night: number;
}

const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Time of day, keyed 0 (dawn) to 1 (night). The page's scroll position walks along this table. */
const KEYS: readonly (Palette & { at: number })[] = [
  {
    at: 0,
    skyTop: rgb("#a9a6ee"),
    skyMid: rgb("#e9d5f3"),
    skyLow: rgb("#ffe2ca"),
    far: rgb("#b5aee9"),
    near: rgb("#2b2560"),
    sun: rgb("#fff0cf"),
    bid: rgb("#6f63e6"),
    ask: rgb("#f2a07f"),
    sunPos: [0.34, 0.03],
    night: 0,
  },
  {
    at: 0.2,
    skyTop: rgb("#8db0f0"),
    skyMid: rgb("#cfe0fa"),
    skyLow: rgb("#fbf0e2"),
    far: rgb("#a6bbe8"),
    near: rgb("#262c66"),
    sun: rgb("#fff6e0"),
    bid: rgb("#5b4fd1"),
    ask: rgb("#ec8f74"),
    sunPos: [0.42, 0.4],
    night: 0,
  },
  {
    at: 0.45,
    skyTop: rgb("#7686e2"),
    skyMid: rgb("#f0bccb"),
    skyLow: rgb("#ffc998"),
    far: rgb("#c58fbb"),
    near: rgb("#2e1f55"),
    sun: rgb("#ffd693"),
    bid: rgb("#5b4fd1"),
    ask: rgb("#ef7f62"),
    sunPos: [-0.16, 0.16],
    night: 0,
  },
  {
    at: 0.65,
    skyTop: rgb("#2d2a7c"),
    skyMid: rgb("#8a4f9e"),
    skyLow: rgb("#f08b7a"),
    far: rgb("#6a3f86"),
    near: rgb("#170f35"),
    sun: rgb("#ffb27a"),
    bid: rgb("#8d7ff5"),
    ask: rgb("#ff8f70"),
    sunPos: [-0.38, -0.08],
    night: 0,
  },
  {
    at: 0.82,
    skyTop: rgb("#0f0e3b"),
    skyMid: rgb("#2a2161"),
    skyLow: rgb("#5b3a7e"),
    far: rgb("#2e2559"),
    near: rgb("#0a0821"),
    sun: rgb("#d7d9ff"),
    bid: rgb("#8d7ff5"),
    ask: rgb("#ff8f70"),
    sunPos: [0.4, 0.2],
    night: 0.75,
  },
  {
    at: 1,
    skyTop: rgb("#05051b"),
    skyMid: rgb("#0d0d30"),
    skyLow: rgb("#2a2663"),
    far: rgb("#44438f"),
    near: rgb("#0b0a2c"),
    sun: rgb("#eceeff"),
    bid: rgb("#8d7ff5"),
    ask: rgb("#ff8f70"),
    sunPos: [0.3, 0.27],
    night: 1,
  },
];

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function paletteAt(day: number): Palette {
  const d = Math.min(1, Math.max(0, day));
  let i = 0;
  while (i < KEYS.length - 2 && d > (KEYS[i + 1] as Palette & { at: number }).at) i++;
  const a = KEYS[i] as Palette & { at: number };
  const b = KEYS[i + 1] as Palette & { at: number };
  const raw = (d - a.at) / (b.at - a.at);
  const t = raw * raw * (3 - 2 * raw);
  return {
    skyTop: mixRgb(a.skyTop, b.skyTop, t),
    skyMid: mixRgb(a.skyMid, b.skyMid, t),
    skyLow: mixRgb(a.skyLow, b.skyLow, t),
    far: mixRgb(a.far, b.far, t),
    near: mixRgb(a.near, b.near, t),
    sun: mixRgb(a.sun, b.sun, t),
    bid: mixRgb(a.bid, b.bid, t),
    ask: mixRgb(a.ask, b.ask, t),
    sunPos: [
      a.sunPos[0] + (b.sunPos[0] - a.sunPos[0]) * t,
      a.sunPos[1] + (b.sunPos[1] - a.sunPos[1]) * t,
    ],
    night: a.night + (b.night - a.night) * t,
  };
}
