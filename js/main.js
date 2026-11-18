import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildWorld } from './world.js';

const $ = (s) => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const low = matchMedia('(max-width: 820px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
document.body.classList.add('loading');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // every dive starts at the surface
scrollTo(0, 0);

/* ================= Depth model ================= */
// World y at each zone boundary, and the real depth in metres it stands for
const YB = [-3, -40, -80, -120, -160, -196];
const MB = [0, 200, 1000, 4000, 6000, 10935];
function metresAt(y) {
  if (y >= YB[0]) return 0;
  for (let i = 0; i < YB.length - 1; i++) {
    if (y >= YB[i + 1]) return lerp(MB[i], MB[i + 1], (YB[i] - y) / (YB[i] - YB[i + 1]));
  }
  return MB[MB.length - 1];
}
const zoneName = (y, m) => (y > -0.5 ? 'Sea level' : m < 200 ? 'Sunlight zone' : m < 1000 ? 'Twilight zone' : m < 4000 ? 'Midnight zone' : m < 6000 ? 'Abyss' : m < 10900 ? 'Hadal zone' : 'Challenger Deep');

// Environment keyframes by world y (top to bottom)
const ENV = [
  { y: 0,    fog: '#1f8fb3', den: 0.028, sun: 2.6, hemi: 1.3, rays: 1.0,  snow: 0.15, bio: 0,   torch: 0 },
  { y: -20,  fog: '#0f6a92', den: 0.032, sun: 1.8, hemi: 1.0, rays: 0.8,  snow: 0.4,  bio: 0,   torch: 0 },
  { y: -40,  fog: '#0a4870', den: 0.036, sun: 0.9, hemi: 0.6, rays: 0.25, snow: 0.6,  bio: 0,   torch: 0 },
  { y: -80,  fog: '#05213d', den: 0.04,  sun: 0.1, hemi: 0.2, rays: 0,    snow: 0.8,  bio: 0.6, torch: 0.25 },
  { y: -120, fog: '#020b18', den: 0.042, sun: 0,   hemi: 0.06, rays: 0,   snow: 0.9,  bio: 1.0, torch: 0.8 },
  { y: -160, fog: '#01060d', den: 0.04,  sun: 0,   hemi: 0.03, rays: 0,   snow: 0.8,  bio: 0.8, torch: 1.0 },
  { y: -196, fog: '#010307', den: 0.034, sun: 0,   hemi: 0.02, rays: 0,   snow: 0.6,  bio: 0.5, torch: 1.0 },
].map((k) => ({ ...k, fogC: new THREE.Color(k.fog) }));
const ABOVE = { fogC: new THREE.Color('#f0a477'), den: 0.004, sun: 3.0, hemi: 1.4, rays: 0, snow: 0, bio: 0, torch: 0 };

const PITCH = [[2.2, -0.06], [0.3, -0.04], [-3, 0.34], [-15, 0.12], [-40, 0.0], [-170, -0.04], [-196, -0.42]];
function pitchAt(y) {
  for (let i = 0; i < PITCH.length - 1; i++) {
    const [y0, p0] = PITCH[i], [y1, p1] = PITCH[i + 1];
    if (y <= y0 && y >= y1) { const k = (y0 - y) / (y0 - y1); return lerp(p0, p1, k * k * (3 - 2 * k)); }
  }
  return y > PITCH[0][0] ? PITCH[0][1] : PITCH[PITCH.length - 1][1];
}
const envOut = { fogC: new THREE.Color() };
function envAt(y) {
  if (y > 0) {
    // blend from the above-water look into the surface key over the first half metre
    const k = clamp(y / 0.4, 0, 1);
    for (const key of ['den', 'sun', 'hemi', 'rays', 'snow', 'bio', 'torch']) envOut[key] = lerp(ENV[0][key], ABOVE[key], k);
    envOut.fogC.copy(ENV[0].fogC).lerp(ABOVE.fogC, k);
    return envOut;
  }
  let i = 0;
  while (i < ENV.length - 2 && y < ENV[i + 1].y) i++;
  const a = ENV[i], b = ENV[i + 1];
  const k = clamp((a.y - y) / (a.y - b.y), 0, 1);
  for (const key of ['den', 'sun', 'hemi', 'rays', 'snow', 'bio', 'torch']) envOut[key] = lerp(a[key], b[key], k);
  envOut.fogC.copy(a.fogC).lerp(b.fogC, k);
  return envOut;
}

/* ================= Scroll -> depth map ================= */
let scrollMap = [[0, 2.2]];
function buildScrollMap() {
  const vh = innerHeight;
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const zones = [...document.querySelectorAll('.zone')];
  const pts = [[0, 2.2], [Math.max(1, top(zones[0]) - vh * 0.55), YB[0]]];
  zones.forEach((z, i) => {
    const end = i < zones.length - 1 ? top(zones[i + 1]) - vh * 0.55 : top($('#floor')) - vh * 0.1;
    pts.push([end, YB[i + 1]]);
  });
  scrollMap = pts;
}
function yFromScroll(s) {
  const m = scrollMap;
  if (s <= m[0][0]) return m[0][1];
  for (let i = 0; i < m.length - 1; i++) {
    if (s <= m[i + 1][0]) return lerp(m[i][1], m[i + 1][1], (s - m[i][0]) / (m[i + 1][0] - m[i][0]));
  }
  return m[m.length - 1][1];
}

/* ================= DOM effects (work without WebGL too) ================= */
const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }), { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

const cursor = $('#cursor');
const mouse = { x: 0, y: 0, sx: 0, sy: 0, px: innerWidth / 2, py: innerHeight / 2, cx: innerWidth / 2, cy: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  mouse.px = e.clientX; mouse.py = e.clientY;
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  cursor.classList.toggle('hover', !!(e.target.closest && e.target.closest('a, button')));
  if (e.pointerType === 'mouse') cursor.classList.add('on');
});

// Hero fades and lifts away as the dive begins
const hero = $('#hero');
const fadeHero = () => {
  const k = clamp(scrollY / (innerHeight * 0.55), 0, 1);
  hero.style.opacity = 1 - k;
  hero.style.transform = `translateY(${-k * 60}px)`;
};
addEventListener('scroll', fadeHero, { passive: true });

$('#ascend').addEventListener('click', (e) => {
  e.preventDefault();
  scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
});

const hud = { depth: $('#depth'), pressure: $('#pressure'), zone: $('#zone-name'), fill: $('#gauge-fill'), last: '' };
function updateHud(y) {
  const m = metresAt(y);
  const key = Math.round(m) + '|' + (y > -0.5);
  if (key === hud.last) return;
  hud.last = key;
  hud.depth.textContent = Math.round(m).toLocaleString('en-US');
  hud.pressure.textContent = '≈ ' + Math.round(1 + m / 10).toLocaleString('en-US') + ' atm';
  hud.zone.textContent = zoneName(y, m);
  hud.fill.style.height = clamp((YB[0] - y) / (YB[0] - YB[YB.length - 1]), 0, 1) * 100 + '%';
  document.body.classList.toggle('diving', y < -0.5);
}

function finishLoading() {
  const num = $('#loader-num');
  const t0 = performance.now(), dur = reduceMotion ? 1 : 1100;
  const tick = () => {
    const k = clamp((performance.now() - t0) / dur, 0, 1);
    num.textContent = Math.round((1 - Math.pow(1 - k, 3)) * 100);
    if (k < 1) setTimeout(tick, 16);
    else {
      document.body.classList.add('ready');
      document.body.classList.remove('loading');
      setTimeout(() => $('#loader').remove(), 1600);
    }
  };
  tick();
}

/* ================= WebGL ================= */
const canvas = $('#gl');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) { renderer = null; }

if (!renderer) {
  document.body.classList.add('no-gl');
  canvas.remove();
  addEventListener('scroll', () => updateHud(yFromScroll(scrollY)), { passive: true });
  buildScrollMap();
  finishLoading();
} else {
  init();
}

function init() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1.25 : 1.6));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1f8fb3, 0.03);
  scene.background = new THREE.Color(0x1f8fb3);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sun.position.set(10, 60, -30);
  const hemi = new THREE.HemisphereLight(0x9fe3ff, 0x062033, 1.2);
  const ambient = new THREE.AmbientLight(0x0a1a2a, 0.25);
  const torch = new THREE.SpotLight(0xd8f4ff, 0, 90, 0.42, 0.55, 1.0);
  torch.position.set(0.25, -0.3, 0);
  const torchTarget = new THREE.Object3D();
  torchTarget.position.set(0, 0, -12);
  camera.add(torch, torchTarget);
  torch.target = torchTarget;

  // Visible torch beam: an additive cone that fades along its length
  const beamGeo = new THREE.ConeGeometry(4.2, 16, 48, 1, true);
  beamGeo.translate(0, -8, 0);
  beamGeo.rotateX(-Math.PI / 2); // tip at the camera, opening forward (-z)
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uBeam: { value: 0 } },
    vertexShader: `varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ vZ = -position.z / 16.0; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uBeam; varying float vZ; varying vec3 vN; varying vec3 vV; void main(){ float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = core * (1.0 - vZ) * smoothstep(0.0, .08, vZ) * uBeam; gl_FragColor = vec4(vec3(.75,.93,1.0) * a, a); }`,
  }));
  beam.position.set(0.25, -0.3, 0);
  camera.add(beam);
  scene.add(sun, hemi, ambient);

  // Uniforms shared by every custom shader
  const U = {
    uTime: { value: 0 }, uCam: { value: camera.position }, uPixel: { value: renderer.getPixelRatio() },
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.03 }, uMouse: { value: new THREE.Vector2() },
    uRays: { value: 0 }, uSnow: { value: 0 }, uBio: { value: 0 },
  };
  const world = buildWorld(scene, camera, U, low);

  // Post-processing: bloom, tone mapping, then film grain + vignette
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.28);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.35 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float uTime, uVig; varying vec2 vUv;
      float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float d = distance(vUv, vec2(.5));
        c.rgb *= 1.0 - smoothstep(.35, .9, d) * uVig;
        c.rgb += (rnd(vUv * 1000.0 + fract(uTime)) - .5) * .045;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grain);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 68 : 55;
    camera.updateProjectionMatrix();
    U.uPixel.value = renderer.getPixelRatio();
    buildScrollMap();
  }
  addEventListener('resize', resize);
  resize();

  let curY = yFromScroll(scrollY);
  const clock = new THREE.Clock();

  function frame(dt, snap) {
    const t = clock.elapsedTime;
    U.uTime.value = t;
    grain.uniforms.uTime.value = t;

    // Smoothly follow the scroll-driven depth
    const target = yFromScroll(scrollY);
    curY = snap || reduceMotion ? target : lerp(curY, target, 1 - Math.exp(-dt * 3.2));

    // Mouse smoothing drives parallax, torch aim and the bioluminescence
    const mk = snap ? 1 : 1 - Math.exp(-dt * 5);
    mouse.sx = lerp(mouse.sx, mouse.x, mk);
    mouse.sy = lerp(mouse.sy, mouse.y, mk);
    U.uMouse.value.set(mouse.sx, mouse.sy);
    mouse.cx = lerp(mouse.cx, mouse.px, snap ? 1 : 1 - Math.exp(-dt * 14));
    mouse.cy = lerp(mouse.cy, mouse.py, snap ? 1 : 1 - Math.exp(-dt * 14));
    cursor.style.transform = `translate3d(${mouse.cx}px, ${mouse.cy}px, 0)`;

    const sway = reduceMotion ? 0 : 1;
    camera.position.set(mouse.sx * 0.5 * sway + Math.sin(t * 0.21) * 0.25 * sway, curY + Math.sin(t * 0.5) * 0.06 * sway, 0);
    camera.rotation.set(pitchAt(curY) + mouse.sy * 0.05 * sway, -mouse.sx * 0.09 * sway + Math.sin(t * 0.13) * 0.025 * sway, 0);
    torchTarget.position.set(mouse.sx * 5.5, mouse.sy * 3.5, -12);
    beam.lookAt(camera.localToWorld(torchTarget.position.clone()));
    beam.rotateY(Math.PI); // cone opens along -z; lookAt points +z at the target

    const e = envAt(curY);
    scene.fog.color.copy(e.fogC);
    scene.fog.density = e.den;
    scene.background.copy(e.fogC);
    U.uFogColor.value.copy(e.fogC);
    U.uFogDensity.value = e.den;
    U.uRays.value = e.rays;
    U.uSnow.value = e.snow;
    U.uBio.value = e.bio;
    sun.intensity = e.sun;
    hemi.intensity = e.hemi;
    torch.intensity = e.torch * 60;
    beam.material.uniforms.uBeam.value = e.torch * 0.06;
    bloom.strength = curY > 0 ? 0.6 : lerp(0.6, 1.15, clamp(-curY / 120, 0, 1));
    bloom.threshold = curY > 0 ? 0.85 : 0.28; // above water only the sun and its glint bloom

    world.update(t);
    composer.render();
    updateHud(curY);
  }

  function loop() {
    requestAnimationFrame(loop);
    frame(Math.min(clock.getDelta(), 0.05), false);
  }

  // ?debug: render a frame on demand (useful when the tab is in the background)
  if (new URLSearchParams(location.search).has('debug')) {
    window.__descent = {
      scene, camera, THREE,
      frame: () => { clock.getDelta(); frame(0.016, true); return { y: curY, m: Math.round(metresAt(curY)) }; },
      // freeze the current render into an overlay <img> so a screenshot can't miss it
      snap: () => {
        clock.getDelta(); frame(0.016, true);
        let img = document.getElementById('snap');
        if (!img) { img = document.createElement('img'); img.id = 'snap'; img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1;pointer-events:none'; document.body.prepend(img); }
        img.src = renderer.domElement.toDataURL('image/jpeg', 0.85);
        return { y: curY, m: Math.round(metresAt(curY)) };
      },
    };
  }

  renderer.compile(scene, camera);
  frame(0.016, true);
  requestAnimationFrame(loop);
  finishLoading();
}
