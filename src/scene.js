/* The room. Everything visual lives here; main.js only moves things. */

import * as THREE from 'three';
import * as K from './config.js';
import { LAYER_COLORS } from './loop.js';

const BTNS = [
  { key: 'rec',   x: -0.62, color: 0xff4d6d },
  { key: 'play',  x:  0.00, color: 0x9dff6b },
  { key: 'clear', x:  0.62, color: 0x8f86c4 },
];

/* soft additive blob, reused for every glow in the scene */
const glowTex = (() => {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
})();

/* thin ring, for the hold-to-change-kit indicator */
const ringTex = (() => {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2); ctx.stroke();
  return new THREE.CanvasTexture(cv);
})();

function glow(color, size, tex = glowTex){
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(size);
  return s;
}

/** Text as a sprite. Cheap, crisp enough, and no font loading in the GL path. */
function label(text, color = '#f2ecff', height = 0.11){
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = '600 68px Archivo, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 70, 470);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  }));
  sp.scale.set(height * 4, height, 1);
  sp.userData.ctx = ctx;
  sp.userData.tex = tex;
  return sp;
}

function setLabel(sp, text, color = '#f2ecff'){
  const ctx = sp.userData.ctx;
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = '600 68px Archivo, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 70, 470);
  sp.userData.tex.needsUpdate = true;
}

export function createScene(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0a18);
  scene.fog = new THREE.Fog(0x0d0a18, 3.2, 8.5);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, K.NEAR, K.FAR);
  camera.position.set(0, 0, 2.9);

  scene.add(new THREE.AmbientLight(0x6a5aa0, 0.55));
  const key = new THREE.PointLight(0xffa06a, 26, 14); key.position.set(-2.2, 1.6, 1.8);
  const rim = new THREE.PointLight(0x6ad8ff, 22, 14); rim.position.set( 2.4, -0.6, 1.2);
  scene.add(key, rim);

  const grid = new THREE.GridHelper(14, 28, 0x3c2f66, 0x241c40);
  grid.position.set(0, -1.25, -2.4);
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);

  /* ── pads ── */
  const pads = [];
  for (let i = 0; i < 5; i++){
    const x = -1.30 + i * 0.65;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.44, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x241c3f, emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.18, roughness: 0.35, metalness: 0.25,
      }));
    mesh.position.set(x, K.PAD_Y, K.PAD_Z);
    mesh.rotation.x = -0.28;
    const halo = glow(0xffffff, 0.95);
    halo.position.set(x, K.PAD_Y, K.PAD_Z + 0.05);
    halo.material.opacity = 0.18;
    const name = label('', '#f2ecff', 0.085);
    name.position.set(x, K.PAD_Y - 0.34, K.PAD_Z + 0.06);
    scene.add(mesh, halo, name);
    pads.push({ mesh, halo, name, x, flash: 0, color: 0xffffff });
  }

  /* ── transport ── */
  function panel(x, y, w, h, color, text, textSize){
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x1c1636, emissive: new THREE.Color(color),
        emissiveIntensity: 0.12, roughness: 0.5,
      }));
    mesh.position.set(x, y, K.PAD_Z);
    const halo = glow(color, Math.max(w, h) * 1.35);
    halo.position.set(x, y, K.PAD_Z + 0.05);
    halo.material.opacity = 0.14;
    const cap = label(text, '#f2ecff', textSize);
    cap.position.set(x, y, K.PAD_Z + 0.07);
    scene.add(mesh, halo, cap);
    return { mesh, halo, cap, color, w, h, flash: 0 };
  }

  const buttons = BTNS.map(b => ({ ...b, ...panel(b.x, K.BTN_Y, 0.46, 0.20, b.color, b.key, 0.075) }));

  const layerButtons = [0, 1, 2, 3].map(i => ({
    index: i,
    ...panel(-0.72 + i * 0.48, K.LAYER_Y, 0.34, 0.16, LAYER_COLORS[i], String(i + 1), 0.07),
  }));

  /* ── step ring ── */
  const ringGroup = new THREE.Group();
  ringGroup.position.set(0, 0.05, -2.15);
  scene.add(ringGroup);
  const stepCells = [];
  for (let i = 0; i < K.STEPS; i++){
    const a = (i / K.STEPS) * Math.PI * 2 - Math.PI / 2;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 0.075, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x2e2552 }));
    m.position.set(Math.cos(a) * 1.22, Math.sin(a) * 0.82, 0);
    ringGroup.add(m);
    stepCells.push(m);
  }

  /* ── pitch guides, one line per scale degree ── */
  const guides = new THREE.Group();
  scene.add(guides);
  function buildGuides(n){
    while (guides.children.length){
      const c = guides.children.pop();
      c.geometry.dispose(); c.material.dispose();
    }
    for (let i = 0; i < n; i++){
      const y = K.NOTE_Y_LO + (i / (n - 1)) * (K.NOTE_Y_HI - K.NOTE_Y_LO);
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(2.9, 0.004),
        new THREE.MeshBasicMaterial({ color: 0x6a5aa0, transparent: true, opacity: 0.12 }));
      g.position.set(0, y, K.PAD_Z - 0.15);
      guides.add(g);
    }
  }
  buildGuides(10);

  /* ── hand cursors ── */
  const cursors = [0, 1].map(() => {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.052, 20, 16),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: new THREE.Color(0xffd9c2),
        emissiveIntensity: 1.1, roughness: 0.2,
      }));
    const halo = glow(0xffc9a8, 0.55);
    const ring = glow(0xffffff, 0.30, ringTex);
    ring.material.opacity = 0;
    core.visible = halo.visible = false;
    scene.add(core, halo, ring);
    return { core, halo, ring };
  });

  /* ── head-coupled off-axis projection ──
   * A normal centred perspective camera reads as a video game. Rebuilding an
   * asymmetric frustum from the tracked eye each frame is what makes the screen
   * read as a box you are looking into. */
  const eye = { x: 0, y: 0, z: 2.9 };
  const eyeTarget = { x: 0, y: 0, z: 2.9 };

  function setEyeTarget(h){
    if (!h) return;
    eyeTarget.x = h.x; eyeTarget.y = h.y; eyeTarget.z = h.z;
  }
  function restEye(){ eyeTarget.x = 0; eyeTarget.y = 0; eyeTarget.z = 2.9; }

  function applyOffAxis(){
    eye.x += (eyeTarget.x - eye.x) * 0.12;
    eye.y += (eyeTarget.y - eye.y) * 0.12;
    eye.z += (eyeTarget.z - eye.z) * 0.08;

    const aspect = innerWidth / innerHeight;
    const w = aspect >= K.WIN_W / K.WIN_H ? K.WIN_H * aspect : K.WIN_W;
    const h = aspect >= K.WIN_W / K.WIN_H ? K.WIN_H : K.WIN_W / aspect;

    const n = K.NEAR / eye.z;
    camera.projectionMatrix.makePerspective(
      (-w / 2 - eye.x) * n, ( w / 2 - eye.x) * n,
      ( h / 2 - eye.y) * n, (-h / 2 - eye.y) * n,
      K.NEAR, K.FAR);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.position.set(eye.x, eye.y, eye.z);
    camera.rotation.set(0, 0, 0);
  }

  /* ── kit ── */
  function applyKit(kit){
    kit.pads.forEach((spec, i) => {
      const p = pads[i];
      if (!p) return;
      const col = new THREE.Color(spec.color ?? '#9a90b8');
      p.color = col.getHex();
      p.mesh.material.emissive.copy(col);
      p.halo.material.color.copy(col);
      setLabel(p.name, spec.name ?? '', '#' + col.getHexString());
    });
    buildGuides((kit.scale ?? []).length || 10);
  }

  function resize(){
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
  }

  return {
    renderer, scene, camera,
    pads, buttons, layerButtons, stepCells, cursors, guides, ringGroup,
    applyKit, applyOffAxis, setEyeTarget, restEye, resize,
    render: () => renderer.render(scene, camera),
  };
}
