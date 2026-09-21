/* Handspace — wiring. Boot, the per-frame loop, and the input rules. */

import * as K from './config.js';
import { Engine } from './audio.js';
import { Loop, LAYER_COLORS } from './loop.js';
import { createScene } from './scene.js';
import { Vision, remap } from './vision.js';
import { Calibration } from './calibrate.js';
import { loadKits } from './kits.js';
import { downloadMidi } from './midi.js';
import { UI } from './ui.js';
import * as store from './storage.js';

const clamp  = (v, a, b) => Math.min(b, Math.max(a, v));
const inRect = (px, py, cx, cy, w, h) => Math.abs(px - cx) <= w / 2 && Math.abs(py - cy) <= h / 2;

const view   = createScene(document.getElementById('scene'));
const vision = new Vision(document.getElementById('cam'));
const calib  = new Calibration();

let engine = null, loop = null;
let kits = [], kitIndex = 0;
let mode = 'boot';               // boot | calibrate | play
let useCamera = false;           // whether hand tracking is even available

/* Gestures that fire on their own are opt-in. An open left hand should not
 * change the kit unless the player asked for that. */
const settings = Object.assign({ palmGesture: false, hands: true }, store.loadSettings());
const persist = () => store.saveSettings(settings);

const ui = new UI({
  onSaveTake:   () => saveTake(),
  onLoadTake:   id => loadTake(id),
  onDeleteTake: id => ui.renderTakes(store.deleteTake(id)),
  onPickCamera: id => pickCamera(id),
});

const newCooldowns = () => ({
  pad: new Array(5).fill(0),
  btn: new Array(3).fill(0),
  lay: new Array(4).fill(0),
});
const coolDecay = c => {
  for (const key of ['pad', 'btn', 'lay']){
    for (let i = 0; i < c[key].length; i++) c[key][i] = Math.max(0, c[key][i] - 1);
  }
};

/* per-hand state that has to survive between frames */
const hand = [0, 1].map(() => ({
  prevZ: K.Z_FRONT,
  cool: newCooldowns(),
  voice: null, noteIdx: null,
  pinchGuard: 0,
  palmFired: false,
  fresh: true,            // first frame after the hand appears — see updateHand
  wasPinch: false,
  anchor: null,
}));

/* mouse / trackpad, always available whether or not the camera is on */
const mouse = { x: 0, y: 0, active: false, voice: null, noteIdx: null, cool: newCooldowns() };

const kit = () => kits[kitIndex];
const refresh = () => ui.setMode(loop, kit()?.name);

/* ───────────────────────── camera ───────────────────────── */

async function pickCamera(id){
  try {
    await vision.useCamera(id);
    store.saveCamera(id);
    ui.toast(`Camera — ${vision.currentCamera()?.label || 'switched'}`);
  } catch (_){
    ui.toast('Could not open that camera');
    ui.selectCamera(vision.currentCamera()?.id ?? '');
  }
}

/* A virtual camera (OBS, a phone bridge) is often the system default and opens
 * without error while feeding nothing but black. Move to real hardware unless
 * the player has said otherwise. */
async function chooseCamera(){
  let cams = [];
  try { cams = await vision.cameras(); } catch (_){ return; }
  const current = vision.currentCamera()?.id ?? null;
  const want = Vision.pick(cams, store.loadCamera(), current);
  if (want && want !== current){
    try { await vision.useCamera(want); } catch (_){}
  }
  ui.setCameras(cams, vision.currentCamera()?.id ?? want);
  const active = vision.currentCamera();
  if (active && cams.find(c => c.id === active.id)?.virtual && cams.some(c => !c.virtual)){
    ui.toast('That is a virtual camera — pick your webcam bottom right', 4000);
  }
}

/* ───────────────────────── transport ───────────────────────── */

function togglePlay(){ loop.playing ? loop.stop() : loop.start(); refresh(); }
function toggleRec(){
  if (!loop.playing) loop.start();
  loop.recording = !loop.recording;
  refresh();
}
function clearLayer(all = false){
  all ? loop.clearAll() : loop.clear();
  ui.toast(all ? 'Cleared every layer' : `Cleared layer ${loop.active + 1}`);
  refresh();
}
function selectLayer(i){
  if (loop.active === i) loop.toggleMute(i);
  else loop.setActive(i);
  refresh();
}
function cycleKit(delta = 1){
  kitIndex = (kitIndex + delta + kits.length) % kits.length;
  engine.setKit(kit());
  view.applyKit(kit());
  // Voices in flight belong to the old kit's lead.
  for (const st of hand){ st.voice?.stop(); st.voice = null; st.noteIdx = null; }
  mouse.voice?.stop(); mouse.voice = null; mouse.noteIdx = null;
  ui.toast(`Kit — ${kit().name}`);
  refresh();
}

function toggleHands(){
  if (!useCamera) return ui.toast('Started without a camera — reload to use your hands');
  settings.hands = !settings.hands;
  persist();
  if (!settings.hands){
    for (let i = 0; i < hand.length; i++) updateHand(i, null);
    view.restEye();
  }
  ui.toast(settings.hands ? 'Hand tracking on' : 'Hand tracking off — mouse and keys still play');
}

function togglePalmGesture(){
  settings.palmGesture = !settings.palmGesture;
  persist();
  ui.toast(settings.palmGesture
    ? 'Open-palm kit change on'
    : 'Open-palm kit change off — use k, or the kit button');
}

function saveTake(){
  if (!loop.count) return ui.toast('Nothing recorded yet');
  const name = `${kit().name} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const takes = store.saveTake(name, kit().id, loop.serialize());
  if (!takes) return ui.toast('Could not save — storage is unavailable');
  ui.renderTakes(takes);
  ui.toast(`Saved "${name}"`);
}

function loadTake(id){
  const t = store.getTake(id);
  if (!t || !loop.load(t.data)) return ui.toast('That take would not load');
  const i = kits.findIndex(k => k.id === t.kit);
  if (i >= 0 && i !== kitIndex){
    kitIndex = i;
    engine.setKit(kit());
    view.applyKit(kit());
  }
  if (!loop.playing) loop.start();
  loop.recording = false;
  ui.toast(`Loaded "${t.name}"`);
  refresh();
}

function exportMidi(){
  ui.toast(downloadMidi(loop, kit(), `handspace-${kit().id}-${Date.now()}.mid`)
    ? 'MIDI exported' : 'Nothing recorded yet');
}

async function recalibrate(){
  if (!useCamera) return ui.toast('Nothing to calibrate without a camera');
  mode = 'calibrate';
  const result = await calib.open({ redo: true });
  if (result){
    vision.setCalibration(result);
    store.saveCalibration(result);
    ui.toast('Calibrated');
  }
  mode = 'play';
}

/* ───────────────────────── hits ───────────────────────── */

function hitPad(i, vel){
  engine.drum(i, undefined, vel);
  loop.capture({ kind: 'drum', pad: i, vel });
  view.pads[i].flash = 1;
  refresh();
}

function hitButton(i){
  view.buttons[i].flash = 1;
  [toggleRec, togglePlay, () => clearLayer(false)][i]();
}

function hitLayer(i){
  view.layerButtons[i].flash = 1;
  selectLayer(i);
}

/** Resolve a strike at a point in the room. Shared by hands and the mouse.
 *  Pads claim the nearest slot inside their band rather than needing a direct
 *  hit — reaching the outer pads should not be the hard part of playing. */
function strikeAt(x, y, vel, cool){
  for (let b = 0; b < view.buttons.length; b++){
    if (cool.btn[b] > 0) continue;
    const btn = view.buttons[b], m = btn.mesh.position;
    if (inRect(x, y, m.x, m.y, btn.w + 0.08, btn.h + 0.12)){
      hitButton(b); cool.btn[b] = K.BTN_LOCKOUT; return true;
    }
  }
  for (let l = 0; l < view.layerButtons.length; l++){
    if (cool.lay[l] > 0) continue;
    const btn = view.layerButtons[l], m = btn.mesh.position;
    if (inRect(x, y, m.x, m.y, btn.w + 0.06, btn.h + 0.10)){
      hitLayer(l); cool.lay[l] = K.BTN_LOCKOUT; return true;
    }
  }
  if (Math.abs(y - K.PAD_Y) > K.PAD_BAND) return false;
  let best = -1, bd = Infinity;
  for (let p = 0; p < view.pads.length; p++){
    const d = Math.abs(x - view.pads[p].x);
    if (d < bd){ bd = d; best = p; }
  }
  if (best < 0 || bd > K.PAD_REACH || cool.pad[best] > 0) return false;
  hitPad(best, vel);
  cool.pad[best] = K.STRIKE_LOCKOUT;
  return true;
}

function noteAt(x, y){
  const scale = engine.scale;
  const fidx = remap(y, K.NOTE_Y_LO, K.NOTE_Y_HI, 0, scale.length - 1);
  return {
    fidx,
    idx: clamp(Math.round(fidx), 0, scale.length - 1),
    scale,
    cutoff: remap(x, -1.8, 1.8, K.CUTOFF_RANGE[0], K.CUTOFF_RANGE[1]),
  };
}

/* ───────────────────────── per-hand logic ───────────────────────── */

function updateHand(i, h){
  const st = hand[i], cur = view.cursors[i];

  if (!h){
    cur.core.visible = cur.halo.visible = false;
    cur.ring.material.opacity = 0;
    if (st.voice){ st.voice.stop(); st.voice = null; st.noteIdx = null; }
    st.prevZ = K.Z_FRONT;
    st.palmFired = false;
    st.fresh = true;
    st.wasPinch = false;
    st.anchor = null;
    return;
  }

  /* The cursor normally rides the index fingertip, which is what you point
   * with. But closing a pinch physically moves that fingertip, which drags the
   * note off its pitch at the exact moment you commit to it. So the instant a
   * pinch engages, latch the position and steer it from the palm centre
   * instead, which barely moves when the fingers do. */
  if (h.pinch && !st.wasPinch) st.anchor = { x: h.x, y: h.y, px: h.px, py: h.py };
  st.wasPinch = h.pinch;
  const nx = (h.pinch && st.anchor) ? st.anchor.x + (h.px - st.anchor.px) : h.x;
  const ny = (h.pinch && st.anchor) ? st.anchor.y + (h.py - st.anchor.py) : h.y;

  cur.core.visible = cur.halo.visible = true;
  cur.core.position.set(nx, ny, h.z);
  cur.halo.position.copy(cur.core.position);
  cur.ring.position.copy(cur.core.position);

  /* open palm on the left of the room, held, cycles the kit — off by default */
  const gesturing = settings.palmGesture && h.openHeld > 0 && nx < 0;
  if (gesturing){
    const p = Math.min(1, h.openHeld / K.PALM_HOLD_MS);
    cur.ring.material.opacity = 0.25 + p * 0.75;
    cur.ring.scale.setScalar(0.34 - p * 0.10);
    if (p >= 1 && !st.palmFired){ st.palmFired = true; cycleKit(1); }
  } else {
    cur.ring.material.opacity = 0;
    st.palmFired = false;
  }

  /* strike — the cursor crosses the pad plane moving away from the viewer.
   * A pinched hand is playing notes, not drumming, so it cannot strike.
   * A hand that reappears already deep has no travel behind it, so the first
   * frame after a detection gap can never count as a strike either. */
  const crossed = !st.fresh && st.prevZ > K.PAD_Z && h.z <= K.PAD_Z;
  if (crossed && !h.pinch && st.pinchGuard <= 0 && !gesturing){
    strikeAt(h.x, h.y, clamp((st.prevZ - h.z) * 3.2, 0.25, 1), st.cool);
  }
  coolDecay(st.cool);
  st.pinchGuard = Math.max(0, st.pinchGuard - 1);
  st.prevZ = h.z;
  st.fresh = false;

  /* pinch → sustained note. Height picks the scale degree, x opens the filter. */
  const n = noteAt(nx, ny);
  if (h.pinch){
    // Switching only once the hand has clearly left the current degree keeps a
    // note sitting on a boundary from machine-gunning between two pitches.
    const moved = st.noteIdx === null || Math.abs(n.fidx - st.noteIdx) > 0.6;
    const idx = moved ? n.idx : st.noteIdx;

    if (!st.voice || idx !== st.noteIdx){
      st.voice?.stop();
      st.voice = engine.note(n.scale[idx], undefined, n.cutoff, 0.8);
      st.noteIdx = idx;
      loop.capture({ kind: 'note', midi: n.scale[idx], cutoff: n.cutoff, vel: 0.7, dur: 0.4 });
      refresh();
    } else {
      st.voice.filter.frequency.setTargetAtTime(n.cutoff, engine.ctx.currentTime, 0.05);
    }
    cur.core.material.emissive.setHex(0x5ce1ff);
    cur.halo.material.color.setHex(0x5ce1ff);
    const guide = view.guides.children[st.noteIdx];
    if (guide) guide.material.opacity = 0.55;
  } else if (st.voice){
    st.voice.stop(); st.voice = null; st.noteIdx = null;
    st.pinchGuard = 10;              // do not read the release as a punch
    st.anchor = null;
    cur.core.material.emissive.setHex(0xffd9c2);
    cur.halo.material.color.setHex(0xffc9a8);
  }

  cur.halo.scale.setScalar(remap(h.z, K.Z_FRONT, K.Z_BACK, 0.45, 0.95));
}

/* ───────────────────────── mouse ───────────────────────── */

function startMouseNote(){
  const n = noteAt(mouse.x, mouse.y);
  mouse.voice = engine.note(n.scale[n.idx], undefined, n.cutoff, 0.8);
  mouse.noteIdx = n.idx;
  loop.capture({ kind: 'note', midi: n.scale[n.idx], cutoff: n.cutoff, vel: 0.7, dur: 0.4 });
  refresh();
}
function stopMouseNote(){
  mouse.voice?.stop();
  mouse.voice = null;
  mouse.noteIdx = null;
}

function updatePointer(){
  const p = view.pointer;
  coolDecay(mouse.cool);
  if (!mouse.active){
    p.core.visible = p.halo.visible = false;
    return;
  }
  p.core.visible = p.halo.visible = true;
  p.core.position.set(mouse.x, mouse.y, K.PAD_Z + 0.07);
  p.halo.position.copy(p.core.position);

  if (!mouse.voice){
    p.core.material.emissive.setHex(0xd9e4ff);
    p.halo.material.color.setHex(0xbcd0ff);
    return;
  }
  const n = noteAt(mouse.x, mouse.y);
  if (n.idx !== mouse.noteIdx){
    mouse.voice.stop();
    mouse.voice = engine.note(n.scale[n.idx], undefined, n.cutoff, 0.8);
    mouse.noteIdx = n.idx;
    loop.capture({ kind: 'note', midi: n.scale[n.idx], cutoff: n.cutoff, vel: 0.7, dur: 0.4 });
    refresh();
  } else {
    mouse.voice.filter.frequency.setTargetAtTime(n.cutoff, engine.ctx.currentTime, 0.05);
  }
  p.core.material.emissive.setHex(0x5ce1ff);
  p.halo.material.color.setHex(0x5ce1ff);
  const guide = view.guides.children[mouse.noteIdx];
  if (guide) guide.material.opacity = 0.55;
}

const overChrome = e => !!(e.target?.closest?.('.takes, .campick, #gate, #calib'));

addEventListener('mousemove', e => {
  if (mode !== 'play' || overChrome(e)) return;
  const p = view.screenToPad(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.active = true;
});

addEventListener('mousedown', e => {
  if (mode !== 'play' || overChrome(e)) return;
  const p = view.screenToPad(e.clientX, e.clientY);
  mouse.x = p.x; mouse.y = p.y; mouse.active = true;
  if (e.button === 0){ e.preventDefault(); strikeAt(mouse.x, mouse.y, K.MOUSE_VEL, mouse.cool); }
  else if (e.button === 2){ e.preventDefault(); startMouseNote(); }
});

addEventListener('mouseup', e => { if (e.button === 2) stopMouseNote(); });
addEventListener('mouseleave', () => { mouse.active = false; stopMouseNote(); });
addEventListener('contextmenu', e => { if (mode === 'play' && !overChrome(e)) e.preventDefault(); });

/* ───────────────────────── frame ───────────────────────── */

let fpsN = 0, fpsT = performance.now(), fpsAvg = 60, lastDegrade = 0;

function frame(now){
  requestAnimationFrame(frame);
  if (mode === 'boot') return;

  const tracking = useCamera && settings.hands;
  const read = tracking ? vision.read(now) : null;

  if (mode === 'calibrate'){
    calib.feed(read?.hands ?? [], now);
    view.restEye();
  } else {
    if (read){
      view.setEyeTarget(read.head);
      for (let i = 0; i < 2; i++) updateHand(i, read.hands[i]);
    }
    updatePointer();
    loop.tick();
  }
  view.applyOffAxis();

  /* step ring */
  const marks = loop?.marks() ?? [];
  const cur = loop?.playing ? Math.floor(loop.phase() * K.STEPS) : -1;
  for (let i = 0; i < K.STEPS; i++){
    const m = view.stepCells[i];
    const here = marks[i] ?? [];
    if (i === cur){
      m.material.color.setHex(loop.recording ? 0xff4d6d : 0x9dff6b);
      m.scale.setScalar(1.75);
    } else if (here.length){
      m.material.color.setHex(LAYER_COLORS[here[0]]).multiplyScalar(0.55);
      m.scale.setScalar(1.25);
    } else {
      m.material.color.setHex(0x2e2552);
      m.scale.setScalar(1);
    }
  }
  view.ringGroup.rotation.z = Math.sin(now * 0.00013) * 0.04;

  /* decays */
  for (const p of view.pads){
    p.flash *= 0.86;
    p.mesh.material.emissiveIntensity = 0.18 + p.flash * 2.6;
    p.halo.material.opacity = 0.18 + p.flash * 0.75;
    p.mesh.position.z = K.PAD_Z - p.flash * 0.10;
  }
  view.buttons.forEach((b, i) => {
    b.flash *= 0.88;
    const lit = (i === 0 && loop?.recording) || (i === 1 && loop?.playing);
    b.mesh.material.emissiveIntensity = (lit ? 0.75 : 0.12) + b.flash * 2.2;
    b.halo.material.opacity = (lit ? 0.30 : 0.14) + b.flash * 0.6;
  });
  view.layerButtons.forEach((b, i) => {
    b.flash *= 0.88;
    const layer = loop?.layers[i];
    const lit = loop?.active === i;
    const dim = layer?.muted ? 0.35 : 1;
    b.mesh.material.emissiveIntensity = ((lit ? 0.7 : 0.10) + b.flash * 2.0) * dim;
    b.halo.material.opacity = ((lit ? 0.30 : 0.10) + b.flash * 0.6) * dim;
    b.cap.material.opacity = layer?.muted ? 0.35 : 1;
  });
  for (const g of view.guides.children){
    g.material.opacity += (0.12 - g.material.opacity) * 0.12;
  }

  view.render();
  if (read) ui.drawPreview(read.landmarks);

  fpsN++;
  if (now - fpsT > 500){
    const fps = Math.round(fpsN * 1000 / (now - fpsT));
    fpsAvg = fpsAvg * 0.6 + fps * 0.4;
    ui.setFps(fps);
    fpsN = 0; fpsT = now;
    if (tracking && fpsAvg < 30 && now - lastDegrade > 4000){
      const every = vision.degrade();
      if (every !== null){
        lastDegrade = now;
        fpsAvg = 45;                       // let it settle before judging again
        if (every === 0){ view.restEye(); ui.toast('Head tracking off — the camera is fixed now'); }
        else ui.toast(`Head tracking eased to every ${every}th frame`);
      }
    }
  }
}

/* ───────────────────────── keys ───────────────────────── */

const PAD_KEYS = { a: 0, s: 1, d: 2, f: 3, g: 4 };

addEventListener('resize', () => view.resize());

addEventListener('keydown', e => {
  if (mode !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLSelectElement) return;
  const k = e.key;
  if (k === ' '){ e.preventDefault(); return togglePlay(); }
  if (k >= '1' && k <= '4') return selectLayer(+k - 1);
  if (k in PAD_KEYS) return hitPad(PAD_KEYS[k], 0.9);
  switch (k){
    case 'r': case 'R': return toggleRec();
    case 'm': case 'M': loop.toggleMute(); return refresh();
    case 'x': return clearLayer(false);
    case 'X': return clearLayer(true);
    case 'k': return cycleKit(1);
    case 'K': return cycleKit(-1);
    case 't': case 'T': return saveTake();
    case 'e': case 'E': return exportMidi();
    case 'h': case 'H': return toggleHands();
    case 'p': case 'P': return togglePalmGesture();
    case 'c': return ui.togglePreview();
    case 'C': return recalibrate();
  }
});

/* ───────────────────────── boot ───────────────────────── */

const gate     = document.getElementById('gate');
const statusEl = document.getElementById('status');
const camBtn   = document.getElementById('startBtn');
const noCamBtn = document.getElementById('noCamBtn');
const setStatus = t => { statusEl.classList.remove('err'); statusEl.textContent = t; };

async function boot(wantCamera){
  camBtn.disabled = noCamBtn.disabled = true;
  try {
    engine = new Engine();
    await engine.ctx.resume();

    kits = await loadKits();
    engine.setKit(kit());
    view.applyKit(kit());
    loop = new Loop(engine, { bpm: K.BPM, bars: K.BARS, steps: K.STEPS });

    if (wantCamera){
      await vision.initCamera(setStatus);
      await chooseCamera();
      await vision.initModels(setStatus);
    }
    useCamera = wantCamera;

    gate.classList.add('hidden');
    ui.show({ camera: wantCamera });
    ui.renderTakes(store.listTakes());
    refresh();

    if (!wantCamera){
      mode = 'play';
      view.restEye();
      return ui.toast('Mouse mode — click a pad, right-click and drag for a note', 5000);
    }

    const saved = store.loadCalibration();
    if (saved){
      vision.setCalibration(saved);
      mode = 'play';
    } else {
      mode = 'calibrate';
      const result = await calib.open();
      if (result){
        vision.setCalibration(result);
        store.saveCalibration(result);
      } else {
        ui.toast('Using default reach — press shift+C to calibrate later', 3200);
      }
      mode = 'play';
    }
  } catch (err){
    camBtn.disabled = noCamBtn.disabled = false;
    gate.classList.remove('hidden');
    mode = 'boot';
    statusEl.classList.add('err');
    statusEl.textContent = err?.name === 'NotAllowedError'
      ? 'Camera blocked. Allow it in the address bar, or play without one.'
      : (err?.message || String(err));
  }
}

camBtn.addEventListener('click', () => boot(true));
noCamBtn.addEventListener('click', () => boot(false));

requestAnimationFrame(frame);
