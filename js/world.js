/*
 * Descent: the world
 * Everything is procedural: shaders, instanced meshes and generated geometry.
 * World units: the surface is y = 0 and the trench floor sits near y = -204.
 */
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

// Fog helper shared by the custom shaders (matches scene FogExp2)
const FOG = /* glsl */`
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  float fogF(float d) { return 1.0 - exp(-d * d * uFogDensity * uFogDensity); }
`;

export function buildWorld(scene, camera, U, low) {
  const updaters = [];

  /* ======================= SKY (above water only) ======================= */
  const sunDir = new THREE.Vector3(0.18, 0.06, -1).normalize(); // low sun: golden hour
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#0b2340') }, horizon: { value: new THREE.Color('#f0a477') }, sunDir: { value: sunDir } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top, horizon, sunDir; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 c = mix(horizon, top, pow(h, 0.42));
          c = mix(c, vec3(.45, .32, .45), smoothstep(.02, .25, h) * (1.0 - smoothstep(.25, .6, h)) * .35); // dusk violet band
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.78, 0.5) * (pow(s, 1400.0) * 9.0 + pow(s, 40.0) * 0.5 + pow(s, 6.0) * 0.18);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  /* ======================= WATER SURFACE ======================= */
  const seg = low ? 140 : 220;
  const waterGeo = new THREE.PlaneGeometry(700, 700, seg, seg);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: U.uTime, uCam: U.uCam, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity,
      uHorizon: { value: new THREE.Color('#f0a477') }, uDeep: { value: new THREE.Color('#03182a') }, sunDir: { value: sunDir },
    },
    vertexShader: /* glsl */`
      uniform float uTime; varying vec3 vWorld; varying vec3 vN;
      float h(vec2 p){
        return sin(p.x*.32 + uTime*.8)*.16 + sin(p.y*.45 - uTime*.95)*.12
             + sin(p.x*.7 + p.y*.9 + uTime*1.6)*.05 + sin(-p.x*1.3 + p.y*1.7 + uTime*2.1)*.025;
      }
      void main(){
        vec3 p = position;
        float fade = 1.0 - smoothstep(60.0, 220.0, length(p.xz));
        p.y += h(p.xz) * fade;
        float e = .12;
        vN = normalize(vec3(h(p.xz - vec2(e,0.)) - h(p.xz + vec2(e,0.)), 2.*e/max(fade,.05), h(p.xz - vec2(0.,e)) - h(p.xz + vec2(0.,e))));
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCam, uHorizon, uDeep, sunDir; uniform float uTime;
      ${FOG}
      varying vec3 vWorld; varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        vec3 toCam = uCam - vWorld; float dist = length(toCam); vec3 v = toCam / dist;
        vec3 col;
        if (uCam.y > 0.0) {
          float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
          col = mix(uDeep, uHorizon * .8, clamp(fres * 1.1, 0.0, 1.0));
          vec3 r = reflect(-v, n);
          float s = max(dot(r, sunDir), 0.0);
          col += vec3(1.0, .72, .42) * (pow(s, 380.0) * 5.0 + pow(s, 30.0) * .35); // sun path on the water
          col = mix(col, uHorizon, 1.0 - exp(-dist * .006));
        } else {
          vec3 d = -v;                                  // camera -> fragment
          float up = max(d.y, 0.0);
          float win = smoothstep(.5, .92, up);          // Snell's window overhead
          float rip = .5 + .5 * sin(vWorld.x*1.9 + uTime*1.2) * sin(vWorld.z*1.6 - uTime*1.05);
          col = mix(uFogColor * 1.5, vec3(.7, .93, 1.0), win * (.75 + .25 * rip));
          col = mix(col, uFogColor, fogF(dist) * .9);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  scene.add(water);

  /* ======================= GOD RAYS ======================= */
  const rayGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  rayGeo.translate(0, -0.5, 0);
  const rayMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime, uRays: U.uRays },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uRays; varying vec2 vUv;
      void main(){
        float edge = pow(sin(vUv.x * 3.14159), 3.0);
        float fall = pow(vUv.y, 2.2);
        float shimmer = .65 + .35 * sin(uTime * .7 + vUv.x * 9.0 + vUv.y * 3.0);
        float a = edge * fall * shimmer * uRays * .32;
        gl_FragColor = vec4(vec3(.72, .93, 1.0) * a, a);
      }`,
  });
  const rays = [];
  for (let i = 0; i < (low ? 9 : 16); i++) {
    const m = new THREE.Mesh(rayGeo, rayMat);
    m.scale.set(rand(1.2, 4.5), rand(35, 70), 1);
    m.position.set(rand(-22, 22), -0.2, rand(-38, -4));
    m.rotation.order = 'YXZ';
    m.userData.tilt = 0.22 + rand(-0.05, 0.05);
    rays.push(m);
    scene.add(m);
  }

  /* ======================= MARINE SNOW ======================= */
  const snowN = low ? 1800 : 4000;
  const sp = new Float32Array(snowN * 3), ss = new Float32Array(snowN);
  for (let i = 0; i < snowN; i++) { sp.set([rand(-20, 20), rand(-20, 20), rand(-20, 20)], i * 3); ss[i] = rand(0.6, 2.4); }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  snowGeo.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
  const snow = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.uTime, uCam: U.uCam, uPixel: U.uPixel, uSnow: U.uSnow, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
    vertexShader: /* glsl */`
      attribute float aSize; uniform float uTime, uPixel, uSnow, uFogDensity; uniform vec3 uCam; varying float vA;
      void main(){
        vec3 p = position;
        p.y -= uTime * (.08 + aSize * .05);
        p.x += sin(uTime * .3 + position.z) * .3;
        p = mod(p - uCam + 20.0, 40.0) - 20.0 + uCam;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        vA = uSnow * smoothstep(.3, 2.5, d) * exp(-d * uFogDensity * 1.4);
        gl_PointSize = aSize * uPixel * (9.0 / max(d, .5));
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(vec3(.86,.92,.95), (1.0 - d*2.0) * vA); }`,
  }));
  snow.frustumCulled = false;
  scene.add(snow);

  /* ======================= FISH SCHOOL (sunlight zone) ======================= */
  const fishN = low ? 140 : 260;
  // simple fish: a flattened body cone plus a tail fin, merged into one geometry
  const body = new THREE.ConeGeometry(0.11, 0.62, 6);
  body.rotateX(Math.PI / 2);
  body.scale(0.55, 1, 1);
  const fin = new THREE.ConeGeometry(0.1, 0.18, 3);
  fin.rotateX(Math.PI / 2); // tip joins the body, wide end trails behind
  fin.translate(0, 0, -0.36);
  fin.scale(0.2, 1, 1);
  const fishGeo = mergeSimple([body, fin]);
  fishGeo.scale(1.5, 1.5, 1.5);
  const fish = new THREE.InstancedMesh(fishGeo, new THREE.MeshStandardMaterial({ color: 0xd9ecf2, emissive: 0x0c3a4d, metalness: 0.35, roughness: 0.35 }), fishN);
  fish.frustumCulled = false;
  const fishData = Array.from({ length: fishN }, () => ({ r: rand(2.5, 6), h: rand(-2.2, 2.2), ph: rand(0, Math.PI * 2), sp: rand(0.28, 0.42), wob: rand(0, 6) }));
  const dummy = new THREE.Object3D();
  const school = new THREE.Vector3(0, -6, -10);
  scene.add(fish);
  updaters.push((t) => {
    if (camera.position.y < -48 || camera.position.y > 0) { fish.visible = false; return; }
    fish.visible = true;
    // the school drifts along with the diver through the sunlight zone, slightly above eye line
    school.y += (Math.max(camera.position.y + 1.2, -40) - school.y) * 0.04;
    school.x = Math.sin(t * 0.07) * 3;
    fishData.forEach((f, i) => {
      const a = f.ph + t * f.sp;
      const r = f.r + Math.sin(t * 0.5 + f.wob) * 0.4;
      dummy.position.set(school.x + Math.cos(a) * r * 1.6, school.y + f.h + Math.sin(a * 2 + f.wob) * 0.5, school.z + Math.sin(a) * r * 0.8);
      dummy.lookAt(dummy.position.x - Math.sin(a) * 1.6, dummy.position.y + Math.cos(a * 2 + f.wob) * 0.3, dummy.position.z + Math.cos(a) * 0.8);
      dummy.updateMatrix();
      fish.setMatrixAt(i, dummy.matrix);
    });
    fish.instanceMatrix.needsUpdate = true;
  });

  /* ======================= JELLYFISH (twilight + midnight) ======================= */
  const bellGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const jellies = [];
  const jellySpecs = [
    [-5, -48, -14, 1.0, '#9fe9ff'], [6, -56, -18, 1.3, '#b9a8ff'], [-2, -63, -10, 0.7, '#9fe9ff'],
    [4, -70, -12, 0.9, '#7fd1ff'], [-7, -77, -20, 1.4, '#c49bff'],
    [3, -88, -11, 1.0, '#ff7ad9'], [-5, -96, -15, 1.2, '#7f9bff'], [6, -104, -19, 1.5, '#ff7ad9'], [-1, -112, -9, 0.8, '#6ff0ff'],
  ];
  jellySpecs.slice(0, low ? 6 : jellySpecs.length).forEach(([x, y, z, s, c], idx) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    const color = new THREE.Color(c);
    const phase = rand(0, 6);
    const bell = new THREE.Mesh(bellGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uCam: U.uCam, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity, uColor: { value: color }, uPhase: { value: phase } },
      vertexShader: /* glsl */`
        uniform float uTime, uPhase; varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vY;
        void main(){
          vec3 p = position;
          float pulse = sin(uTime * 1.6 + uPhase);
          p.xz *= 1.0 + .16 * pulse * (1.0 - p.y);
          p.y *= 1.0 - .12 * pulse;
          vY = p.y;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vV = normalize(-mv.xyz);
          vW = (modelMatrix * vec4(p, 1.0)).xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor, uCam; uniform float uTime, uPhase;
        ${FOG}
        varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vY;
        void main(){
          float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float glow = pow(rim, 2.4);
          float bands = .5 + .5 * sin(vY * 28.0 - uTime * 2.0 + uPhase);
          vec3 col = uColor * (.18 + glow * 2.2 + bands * .12 + (1.0 - vY) * .25);
          float a = (.12 + glow * .9) * (1.0 - fogF(length(uCam - vW)) * .85);
          gl_FragColor = vec4(col * a, a);
        }`,
    }));
    g.add(bell);
    // Tentacles: CPU-animated lines
    const T = low ? 7 : 11, P = 26;
    const tentGeo = new THREE.BufferGeometry();
    const tpos = new Float32Array(T * P * 2 * 3); // line segments
    tentGeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    const tent = new THREE.LineSegments(tentGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    tent.frustumCulled = false;
    g.add(tent);
    const lens = Array.from({ length: T }, () => rand(2.2, 4.8));
    scene.add(g);
    jellies.push({ g, tpos, tentGeo, T, P, lens, phase, baseY: y, idx });
  });
  updaters.push((t) => {
    const cy = camera.position.y;
    jellies.forEach((j) => {
      const near = Math.abs(j.baseY - cy) < 45;
      j.g.visible = near;
      if (!near) return;
      const pulse = Math.sin(t * 1.6 + j.phase);
      j.g.position.y = j.baseY + Math.sin(t * 0.35 + j.phase) * 0.8 + pulse * 0.08;
      j.g.rotation.y = t * 0.05 + j.phase;
      let k = 0;
      for (let a = 0; a < j.T; a++) {
        const ang = (a / j.T) * Math.PI * 2;
        const r0 = 0.82 * (1 + 0.14 * pulse);
        let px = Math.cos(ang) * r0, py = 0, pz = Math.sin(ang) * r0;
        for (let p = 1; p <= j.P; p++) {
          const f = p / j.P;
          const nx = Math.cos(ang) * r0 * (1 - f * 0.55) + Math.sin(t * 1.3 + p * 0.32 + a) * 0.18 * f * 2.2;
          const ny = -f * j.lens[a];
          const nz = Math.sin(ang) * r0 * (1 - f * 0.55) + Math.cos(t * 1.1 + p * 0.29 + a * 1.7) * 0.18 * f * 2.2;
          j.tpos[k++] = px; j.tpos[k++] = py; j.tpos[k++] = pz;
          j.tpos[k++] = nx; j.tpos[k++] = ny; j.tpos[k++] = nz;
          px = nx; py = ny; pz = nz;
        }
      }
      j.tentGeo.attributes.position.needsUpdate = true;
    });
  });

  /* ======================= BIOLUMINESCENCE (midnight + abyss) ======================= */
  const bioN = low ? 1400 : 3600;
  const bp = new Float32Array(bioN * 3), bph = new Float32Array(bioN), bsp = new Float32Array(bioN), bc = new Float32Array(bioN * 3);
  const palette = [new THREE.Color('#5ff3ff'), new THREE.Color('#4d7dff'), new THREE.Color('#7dffb2'), new THREE.Color('#c77dff')];
  for (let i = 0; i < bioN; i++) {
    bp.set([rand(-24, 24), rand(-178, -78), rand(-30, 2)], i * 3);
    bph[i] = rand(0, 100); bsp[i] = rand(0.3, 1.4);
    const c = palette[Math.random() < 0.6 ? 0 : (1 + Math.floor(Math.random() * 3))];
    bc.set([c.r, c.g, c.b], i * 3);
  }
  const bioGeo = new THREE.BufferGeometry();
  bioGeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  bioGeo.setAttribute('aPhase', new THREE.BufferAttribute(bph, 1));
  bioGeo.setAttribute('aSpeed', new THREE.BufferAttribute(bsp, 1));
  bioGeo.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
  const bio = new THREE.Points(bioGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uPixel: U.uPixel, uBio: U.uBio, uMouse: U.uMouse, uFogDensity: U.uFogDensity, uFogColor: U.uFogColor },
    vertexShader: /* glsl */`
      attribute float aPhase, aSpeed; attribute vec3 aColor;
      uniform float uTime, uPixel, uBio, uFogDensity; uniform vec2 uMouse;
      varying vec3 vColor; varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * .2 + aPhase) * .5;
        p.y += cos(uTime * .15 + aPhase * 1.3) * .4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec4 clip = projectionMatrix * mv;
        gl_Position = clip;
        vec2 ndc = clip.xy / clip.w;
        float m = smoothstep(.42, .0, distance(ndc * vec2(1.0, .62), uMouse * vec2(1.0, .62)));
        float blink = pow(max(sin(uTime * aSpeed + aPhase), 0.0), 10.0);
        float d = -mv.z;
        vA = (blink * 1.0 + m * 1.5 + .14) * uBio * exp(-d * uFogDensity * .45) * step(0.0, d);
        vColor = aColor;
        gl_PointSize = (1.6 + 9.0 * (blink + m * 1.3)) * uPixel * (14.0 / max(d, 1.0));
      }`,
    fragmentShader: `varying vec3 vColor; varying float vA; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; float g = pow(1.0 - d * 2.0, 1.8); gl_FragColor = vec4(vColor * 1.6, g * vA); }`,
  }));
  bio.frustumCulled = false;
  scene.add(bio);

  /* ======================= ANGLERFISH (abyss) ======================= */
  const anglers = [];
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.55, metalness: 0.15 });
  [[-6, -128, -16], [7, -139, -22], [-3, -150, -12], [5, -166, -15]].forEach(([x, y, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), bodyMat);
    body.scale.set(1.0, 0.75, 1.4);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 16), bodyMat);
    tail.rotation.x = -Math.PI / 2; tail.position.z = -1.7; tail.scale.set(1, 0.3, 1);
    const stalkCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.6, 0.6), new THREE.Vector3(0, 1.8, 1.0), new THREE.Vector3(0, 1.3, 2.2));
    const stalk = new THREE.Mesh(new THREE.TubeGeometry(stalkCurve, 16, 0.03, 6), bodyMat);
    const lure = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 3.2, 3.0) }));
    lure.position.set(0, 1.3, 2.2);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7ff6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(1.6);
    halo.position.copy(lure.position);
    g.add(body, tail, stalk, lure, halo);
    g.rotation.y = rand(-0.9, 0.9);
    scene.add(g);
    anglers.push({ g, lure, halo, ph: rand(0, 6), baseY: y, baseX: x });
  });
  updaters.push((t) => {
    anglers.forEach((a) => {
      a.g.position.y = a.baseY + Math.sin(t * 0.4 + a.ph) * 0.5;
      a.g.position.x = a.baseX + Math.sin(t * 0.13 + a.ph) * 1.2;
      const flick = 0.75 + 0.25 * Math.sin(t * 6 + a.ph) * Math.sin(t * 2.3 + a.ph * 2);
      a.halo.scale.setScalar(1.4 + flick * 0.6);
      a.halo.material.opacity = flick;
    });
  });

  /* ======================= TRENCH FLOOR (hadal) ======================= */
  const FS = low ? 120 : 190;
  const floorGeo = new THREE.PlaneGeometry(220, 220, FS, FS);
  floorGeo.rotateX(-Math.PI / 2);
  const noise = (x, z) => Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2.0) * Math.cos(z * 0.17 + Math.sin(x * 0.11) * 1.7);
  const heightAt = (x, z) => {
    const wall = Math.pow(Math.min(Math.abs(x + Math.sin(z * 0.05) * 6) / 24, 1.8), 2.2) * 22;
    return -203 + wall + noise(x, z) * 2.2 + noise(x * 2.7, z * 2.3) * 0.7 + noise(x * 7.1, z * 6.3) * 0.18;
  };
  const fp = floorGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setY(i, heightAt(fp.getX(i), fp.getZ(i)));
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: 0x5b554c, roughness: 0.96, metalness: 0, flatShading: true }));
  floor.receiveShadow = true;
  scene.add(floor);
  const rockN = low ? 80 : 160;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x4a453e, roughness: 0.9, flatShading: true }), rockN);
  for (let i = 0; i < rockN; i++) {
    const x = rand(-22, 22), z = rand(-50, 10), s = Math.pow(Math.random(), 2.5) * 1.4 + 0.15;
    dummy.position.set(x, heightAt(x, z) + s * 0.3, z);
    dummy.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    dummy.scale.set(s, s * rand(0.5, 0.9), s * rand(0.8, 1.3));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  scene.add(rocks);

  /* ======================= per-frame ======================= */
  const tmp = new THREE.Vector3();
  function update(t) {
    const cy = camera.position.y;
    sky.position.copy(camera.position);
    sky.visible = cy > -1;
    rays.forEach((m) => {
      m.visible = cy < 3 && cy > -60;
      if (!m.visible) return;
      tmp.subVectors(camera.position, m.position);
      m.rotation.set(0, Math.atan2(tmp.x, tmp.z), m.userData.tilt);
    });
    floor.visible = rocks.visible = cy < -130;
    bio.visible = cy < -60;
    updaters.forEach((u) => u(t));
  }
  return { update, heightAt };
}

// Merge non-indexed copies of simple geometries (avoids pulling in BufferGeometryUtils)
function mergeSimple(geos) {
  const parts = geos.map((g) => g.toNonIndexed());
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  parts.forEach((g) => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function glowTexture() {
  if (glowTexture.tex) return glowTexture.tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTexture.tex = new THREE.CanvasTexture(c);
  return glowTexture.tex;
}
