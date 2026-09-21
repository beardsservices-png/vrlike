/* Handspace — wiring. Boot, the per-frame loop, and the gesture rules. */

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

const ui = new UI({
  onSaveTake:   () => saveTake(),
  onLoadTake:   id => loadTake(id),
  onDeleteTake: id => ui.renderTakes(store.deleteTake(id)),
});

/* per-hand state that has to survive between frames */
const hand = [0, 1].map(() => ({
  prevZ: K.Z_FRONT,
  cool: new Array(5).fill(0),
  btnCool: new Array(3).fill(0),
  layCool: new Array(4).fill(0),
  voice: null, noteIdx: null,
  pinchGuard: 0,
  palmFired: false,
  fresh: true,          // first frame after the hand appears — see updateHand
}));

const kit = () => kits[kitIndex];
const refresh = () => ui.setMode(loop, kit()?.name);

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
  ui.toast(`Kit — ${kit().name}`);
  refresh();
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
    return;
  }

  cur.core.visible = cur.halo.visible = true;
  cur.core.position.set(h.x, h.y, h.z);
  cur.halo.position.copy(cur.core.position);
  cur.ring.position.copy(cur.core.position);

  /* open palm on the left of the room, held, cycles the kit */
  const gesturing = h.openHeld > 0 && h.x < 0;
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
   * A pinched hand is playing notes, not drumming, so it cannot strike. */
  // A hand that reappears already deep in the room has no travel behind it, so
  // the first frame after a detection gap can never count as a strike.
  const crossed = !st.fresh && st.prevZ > K.PAD_Z && h.z <= K.PAD_Z;
  if (crossed && !h.pinch && st.pinchGuard <= 0 && !gesturing){
    const vel = clamp((st.prevZ - h.z) * 3.2, 0.25, 1);
    let done = false;
    for (let p = 0; p < view.pads.length && !done; p++){
      if (st.cool[p] > 0) continue;
      const m = view.pads[p].mesh.position;
      if (inRect(h.x, h.y, m.x, m.y, K.PAD_HIT.w, K.PAD_HIT.h)){
        hitPad(p, vel); st.cool[p] = K.STRIKE_LOCKOUT; done = true;
      }
    }
    for (let b = 0; b < view.buttons.length && !done; b++){
      if (st.btnCool[b] > 0) continue;
      const btn = view.buttons[b], m = btn.mesh.position;
      if (inRect(h.x, h.y, m.x, m.y, btn.w + 0.08, btn.h + 0.12)){
        hitButton(b); st.btnCool[b] = K.BTN_LOCKOUT; done = true;
      }
    }
    for (let l = 0; l < view.layerButtons.length && !done; l++){
      if (st.layCool[l] > 0) continue;
      const btn = view.layerButtons[l], m = btn.mesh.position;
      if (inRect(h.x, h.y, m.x, m.y, btn.w + 0.06, btn.h + 0.10)){
        hitLayer(l); st.layCool[l] = K.BTN_LOCKOUT; done = true;
      }
    }
  }
  for (let n = 0; n < st.cool.length; n++)    st.cool[n]    = Math.max(0, st.cool[n] - 1);
  for (let n = 0; n < st.btnCool.length; n++) st.btnCool[n] = Math.max(0, st.btnCool[n] - 1);
  for (let n = 0; n < st.layCool.length; n++) st.layCool[n] = Math.max(0, st.layCool[n] - 1);
  st.pinchGuard = Math.max(0, st.pinchGuard - 1);
  st.prevZ = h.z;
  st.fresh = false;

  /* pinch → sustained note. Height picks the scale degree, x opens the filter. */
  const scale = engine.scale;
  const fidx  = remap(h.y, K.NOTE_Y_LO, K.NOTE_Y_HI, 0, scale.length - 1);
  const cutoff = remap(h.x, -1.8, 1.8, K.CUTOFF_RANGE[0], K.CUTOFF_RANGE[1]);

  if (h.pinch){
    // Switching only once the hand has clearly left the current degree keeps a
    // note sitting on a boundary from machine-gunning between two pitches.
    const moved = st.noteIdx === null || Math.abs(fidx - st.noteIdx) > 0.6;
    const idx = moved ? clamp(Math.round(fidx), 0, scale.length - 1) : st.noteIdx;

    if (!st.voice || idx !== st.noteIdx){
      st.voice?.stop();
      st.voice = engine.note(scale[idx], undefined, cutoff, 0.8);
      st.noteIdx = idx;
      loop.capture({ kind: 'note', midi: scale[idx], cutoff, vel: 0.7, dur: 0.4 });
      refresh();
    } else {
      st.voice.filter.frequency.setTargetAtTime(cutoff, engine.ctx.currentTime, 0.05);
    }
    cur.core.material.emissive.setHex(0x5ce1ff);
    cur.halo.material.color.setHex(0x5ce1ff);
    const guide = view.guides.children[st.noteIdx];
    if (guide) guide.material.opacity = 0.55;
  } else if (st.voice){
    st.voice.stop(); st.voice = null; st.noteIdx = null;
    st.pinchGuard = 10;              // do not read the release as a punch
    cur.core.material.emissive.setHex(0xffd9c2);
    cur.halo.material.color.setHex(0xffc9a8);
  }

  cur.halo.scale.setScalar(remap(h.z, K.Z_FRONT, K.Z_BACK, 0.45, 0.95));
}

/* ───────────────────────── frame ───────────────────────── */

let fpsN = 0, fpsT = performance.now(), fpsAvg = 60, lastDegrade = 0;

function frame(now){
  requestAnimationFrame(frame);
  if (mode === 'boot') return;

  const read = vision.read(now);

  if (mode === 'calibrate'){
    calib.feed(read.hands, now);
    view.restEye();
  } else {
    view.setEyeTarget(read.head);
    for (let i = 0; i < 2; i++) updateHand(i, read.hands[i]);
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
  ui.drawPreview(read.landmarks);

  /* fps, and the performance ladder */
  fpsN++;
  if (now - fpsT > 500){
    const fps = Math.round(fpsN * 1000 / (now - fpsT));
    fpsAvg = fpsAvg * 0.6 + fps * 0.4;
    ui.setFps(fps);
    fpsN = 0; fpsT = now;
    if (fpsAvg < 30 && now - lastDegrade > 4000){
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

/* ───────────────────────── input ───────────────────────── */

addEventListener('resize', () => view.resize());

addEventListener('keydown', e => {
  if (mode !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === ' '){ e.preventDefault(); return togglePlay(); }
  if (k >= '1' && k <= '4') return selectLayer(+k - 1);
  switch (k){
    case 'r': case 'R': return toggleRec();
    case 'm': case 'M': loop.toggleMute(); return refresh();
    case 'x': return clearLayer(false);
    case 'X': return clearLayer(true);
    case 'k': return cycleKit(1);
    case 'K': return cycleKit(-1);
    case 's': case 'S': return saveTake();
    case 'e': case 'E': return exportMidi();
    case 'c': return ui.togglePreview();
    case 'C': return recalibrate();
  }
});

/* ───────────────────────── boot ───────────────────────── */

document.getElementById('startBtn').addEventListener('click', async () => {
  const gate = document.getElementById('gate');
  const st = document.getElementById('status');
  const btn = document.getElementById('startBtn');
  const setStatus = t => { st.classList.remove('err'); st.textContent = t; };
  btn.disabled = true;

  try {
    engine = new Engine();
    await engine.ctx.resume();

    kits = await loadKits();
    engine.setKit(kit());
    view.applyKit(kit());
    loop = new Loop(engine, { bpm: K.BPM, bars: K.BARS, steps: K.STEPS });

    await vision.initCamera(setStatus);
    await vision.initModels(setStatus);

    gate.classList.add('hidden');
    ui.show();
    ui.renderTakes(store.listTakes());
    refresh();

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
    btn.disabled = false;
    gate.classList.remove('hidden');
    mode = 'boot';
    st.classList.add('err');
    st.textContent = err?.name === 'NotAllowedError'
      ? 'Camera blocked. Allow it in the address bar, then try again.'
      : (err?.message || String(err));
  }
});

requestAnimationFrame(frame);
