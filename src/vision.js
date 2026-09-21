/* Camera, MediaPipe, and the mapping from landmarks to a point in the room. */

import { FilesetResolver, HandLandmarker, FaceDetector } from '@mediapipe/tasks-vision';
import { OneEuroBank } from './filter.js';
import * as K from './config.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp  = (a, b, t) => a + (b - a) * t;
export const remap = (v, a, b, c, d) => lerp(c, d, clamp((v - a) / (b - a), 0, 1));

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* Virtual cameras (OBS, Snap, phone-as-webcam bridges) enumerate exactly like real
 * hardware and are often the system default, but nothing is feeding them unless
 * their host app is running — you get a black frame and no error. Prefer real
 * hardware, and let the player override. */
const VIRTUAL = /virtual|obs\b|manycam|xsplit|snap camera|droidcam|epoccam|iriun|nvidia broadcast|streamlabs|vtube|reincubate|camo|splitcam|e2esoft|vcam/i;

/** Apparent palm size — the depth proxy. Averaging five bones across the palm
 *  rather than one wrist-to-knuckle segment keeps it steady while the hand
 *  rotates, which is most of what a player does while drumming. */
export function palmSpan(lm){
  const w = lm[0];
  return (dist(w, lm[5]) + dist(w, lm[9]) + dist(w, lm[13]) + dist(w, lm[17]) + dist(lm[5], lm[17])) / 5;
}

/** Centre of the palm: wrist plus the four knuckles. Unlike a fingertip this
 *  barely moves when the fingers curl, so it is what a pinch should be steered
 *  by — otherwise the act of pinching drags the cursor off the note. */
export function palmCenter(lm){
  let x = 0, y = 0;
  for (const i of [0, 5, 9, 13, 17]){ x += lm[i].x; y += lm[i].y; }
  return { x: x / 5, y: y / 5 };
}

/** Four fingers extended and the thumb away from the palm. */
export function openPalm(lm){
  const w = lm[0];
  let up = 0;
  for (const [pip, tip] of [[6, 8], [10, 12], [14, 16], [18, 20]]){
    if (dist(w, lm[tip]) > dist(w, lm[pip]) * 1.25) up++;
  }
  const thumbOut = dist(lm[4], lm[17]) > dist(lm[0], lm[5]) * 0.8;
  return up >= 4 && thumbOut;
}

export class Vision {
  constructor(video){
    this.video = video;
    this.hands = null;
    this.faces = null;
    this.calib = { ...K.SPAN_DEFAULT };
    this.faceTier = 0;                 // index into K.FACE_EVERY
    this.frame = 0;
    this.lastVideoTime = -1;
    this.handRes = null;
    this.faceRes = null;
    this.slots = [this._slot(), this._slot()];
  }

  _slot(){
    return {
      live: false,
      // Position needs to be quiet at rest but must not lag a strike, so beta
      // is high on the depth axis where strikes happen.
      filt: new OneEuroBank({
        x:    { minCutoff: 1.2, beta: 0.035 },
        y:    { minCutoff: 1.2, beta: 0.035 },
        span: { minCutoff: 1.0, beta: 0.090 },
        pinch:{ minCutoff: 2.5, beta: 0.010 },
        px:   { minCutoff: 1.2, beta: 0.035 },
        py:   { minCutoff: 1.2, beta: 0.035 },
      }),
      pinching: false,
      openSince: 0,
      label: null,
    };
  }

  setCalibration(c){
    if (c && c.near > c.far) this.calib = { near: c.near, far: c.far };
  }

  /* ───────── setup ───────── */

  async initCamera(setStatus){
    if (!navigator.mediaDevices?.getUserMedia){
      throw new Error("This browser won't share a camera here. Serve the page over http://localhost or https.");
    }
    setStatus('Asking for the camera…');
    // Opening the default device first is what unlocks device labels; without a
    // granted stream, enumerateDevices() returns blank names we cannot judge.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } },
      audio: false,
    });
    await this._attach(stream);
  }

  async _attach(stream){
    const old = this.video.srcObject;
    this.video.srcObject = stream;
    if (old && old !== stream) for (const t of old.getTracks()) t.stop();
    this.lastVideoTime = -1;               // the new track restarts currentTime
    for (const s of this.slots) s.filt.reset();
    await this.video.play();
  }

  /** Video inputs, flagged so a virtual camera is never chosen silently. */
  async cameras(){
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'videoinput').map(d => ({
      id: d.deviceId,
      label: d.label || 'Camera',
      virtual: VIRTUAL.test(d.label || ''),
    }));
  }

  currentCamera(){
    const t = this.video.srcObject?.getVideoTracks?.()[0];
    if (!t) return null;
    return { id: t.getSettings?.().deviceId ?? null, label: t.label || '' };
  }

  /** Prefer a remembered choice, else the first camera that is real hardware. */
  static pick(cams, saved, current){
    if (saved && cams.some(c => c.id === saved)) return saved;
    const real = cams.find(c => !c.virtual);
    if (real && (!current || cams.find(c => c.id === current)?.virtual)) return real.id;
    return current;
  }

  async useCamera(id){
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: id }, width: { ideal: 960 }, height: { ideal: 540 } },
      audio: false,
    });
    await this._attach(stream);
    return id;
  }

  async initModels(setStatus){
    setStatus('Loading the hand model…');
    const fileset = await FilesetResolver.forVisionTasks(WASM);

    this.hands = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
    });

    // Head tracking is a bonus. Without it the camera simply stops moving.
    try {
      setStatus('Loading the head model…');
      this.faces = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
      });
    } catch (_){
      this.faces = null;
    }
  }

  /** Step down the performance ladder: face every 3rd frame, then 5th, then off. */
  degrade(){
    if (this.faceTier >= K.FACE_EVERY.length - 1) return null;
    this.faceTier++;
    const every = K.FACE_EVERY[this.faceTier];
    if (every === 0) this.faceRes = null;
    return every;
  }

  /* ───────── per-frame read ───────── */

  read(nowMs){
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime){
      this.lastVideoTime = v.currentTime;
      this.frame++;
      try { this.handRes = this.hands.detectForVideo(v, nowMs); } catch (_){}

      const every = K.FACE_EVERY[this.faceTier];
      if (this.faces && every > 0 && this.frame % every === 0){
        try { this.faceRes = this.faces.detectForVideo(v, nowMs); } catch (_){}
      }
    }
    const t = nowMs / 1000;
    return {
      hands: this._hands(t),
      head: this._head(),
      landmarks: this.handRes?.landmarks ?? [],
    };
  }

  /** Handedness gives a stable slot, so a filter never carries one hand's
   *  history into the other when MediaPipe reorders its output. */
  _assign(){
    const res = this.handRes;
    const lms = res?.landmarks ?? [];
    const hands = res?.handednesses ?? res?.handedness ?? [];
    const out = [null, null];
    const spare = [];
    lms.forEach((lm, i) => {
      const label = hands[i]?.[0]?.categoryName;
      const want = label === 'Left' ? 0 : label === 'Right' ? 1 : -1;
      if (want >= 0 && !out[want]) out[want] = { lm, label };
      else spare.push({ lm, label });
    });
    for (const s of spare){
      const free = out.indexOf(null);
      if (free >= 0) out[free] = s;
    }
    return out;
  }

  _hands(t){
    const found = this._assign();
    return this.slots.map((slot, i) => {
      const hit = found[i];
      if (!hit){
        if (slot.live){ slot.filt.reset(); slot.pinching = false; slot.openSince = 0; }
        slot.live = false;
        return null;
      }

      const lm = hit.lm;
      const tip = lm[8], thumb = lm[4];
      const rawSpan = palmSpan(lm);
      const pc = palmCenter(lm);
      const sx = 1 - tip.x;                      // mirror, so moving right moves the cursor right
      const f = slot.filt.filter({
        x: (sx - 0.5) * (K.WIN_W * 1.25),
        y: (0.5 - tip.y) * (K.WIN_H * 1.5),
        px: ((1 - pc.x) - 0.5) * (K.WIN_W * 1.25),
        py: (0.5 - pc.y) * (K.WIN_H * 1.5),
        span: rawSpan,
        pinch: dist(tip, thumb) / Math.max(rawSpan, 1e-4),
      }, t);

      // Hysteresis: one threshold makes a held pinch stutter at the boundary.
      slot.pinching = slot.pinching ? f.pinch < K.PINCH_OFF : f.pinch < K.PINCH_ON;

      const open = !slot.pinching && openPalm(lm);
      if (open){ if (!slot.openSince) slot.openSince = t * 1000; }
      else slot.openSince = 0;

      slot.live = true;
      return {
        slot: i,
        label: hit.label,
        x: f.x,
        y: f.y,
        px: f.px,
        py: f.py,
        z: remap(f.span, this.calib.far, this.calib.near, K.Z_FRONT, K.Z_BACK),
        span: rawSpan,
        pinch: slot.pinching,
        pinchAmt: f.pinch,
        openHeld: slot.openSince ? t * 1000 - slot.openSince : 0,
      };
    });
  }

  _head(){
    const d = this.faceRes?.detections?.[0];
    if (!d) return null;
    const bb = d.boundingBox;
    const vw = this.video.videoWidth || 960, vh = this.video.videoHeight || 540;
    const cx = (bb.originX + bb.width / 2) / vw;
    const cy = (bb.originY + bb.height / 2) / vh;
    return {
      x: ((1 - cx) - 0.5) * 2.4,
      y: (0.42 - cy) * 1.5,
      z: remap(bb.width / vw, 0.42, 0.13, 1.9, 4.0),
    };
  }
}
