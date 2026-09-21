/* Web Audio engine. Every voice is driven by plain numbers off a kit JSON file,
 * so a new kit is a data file, not code. */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mtof  = m => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  constructor(){
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    const c = this.ctx;

    this.out = c.createDynamicsCompressor();
    this.out.threshold.value = -14; this.out.ratio.value = 4;
    this.out.connect(c.destination);

    this.bus = c.createGain(); this.bus.gain.value = 0.9;
    this.bus.connect(this.out);

    this.verb = c.createConvolver(); this.verb.buffer = this._impulse(2.4, 2.6);
    this.send = c.createGain(); this.send.gain.value = 0.26;
    this.send.connect(this.verb); this.verb.connect(this.out);

    this.noise = this._noise(2);
    this.kit = null;
  }

  setKit(kit){ this.kit = kit; }
  get scale(){ return this.kit?.scale ?? [57,60,62,64,67,69,72,74,76,79]; }

  _noise(sec){
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(sec, decay){
    const rate = this.ctx.sampleRate, len = Math.floor(rate * sec);
    const b = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++){
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  _tap(node, gain){
    node.connect(this.bus);
    const s = this.ctx.createGain(); s.gain.value = gain;
    node.connect(s); s.connect(this.send);
  }
  _src(){
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;   // stops repeated hits phasing
    return n;
  }

  /* ───────── drums ───────── */

  /** @param pad index into the kit pad array. Loops store the slot, not the sound,
   *  so switching kits re-voices a pattern that is already recorded. */
  drum(pad, when, vel = 1){
    if (!this.kit) return;
    const spec = this.kit.pads[clamp(pad, 0, this.kit.pads.length - 1)];
    if (!spec) return;
    const c = this.ctx, t = when ?? c.currentTime;
    const v = clamp(vel, 0.12, 1) * (spec.gain ?? 1);
    const g = c.createGain(); this._tap(g, spec.send ?? 0.35);

    switch (spec.voice){
      case 'noise': this._vNoise(g, t, v, spec); break;
      case 'metal': this._vMetal(g, t, v, spec); break;
      default:      this._vBody (g, t, v, spec); break;   // kick, tom, conga
    }
  }

  /** Pitched body with an exponential drop — kicks, toms, congas. */
  _vBody(g, t, v, s){
    const c = this.ctx;
    const from = s.from ?? 140, to = Math.max(20, s.to ?? 44);
    const drop = s.drop ?? 0.14, dec = s.decay ?? 0.45;
    const o = c.createOscillator(); o.type = s.wave ?? 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + drop);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    o.connect(g); o.start(t); o.stop(t + dec + 0.05);

    if (s.click){                                  // beater transient
      const n = this._src();
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2400;
      const cg = c.createGain();
      cg.gain.setValueAtTime(v * s.click, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      n.connect(f); f.connect(cg); cg.connect(g); n.start(t); n.stop(t + 0.04);
    }
  }

  /** Filtered noise, optionally with a tuned body under it — snares, hats, claps. */
  _vNoise(g, t, v, s){
    const c = this.ctx;
    const dec = s.decay ?? 0.2;
    const n = this._src();
    const f = c.createBiquadFilter();
    f.type = s.filter ?? 'bandpass';
    f.frequency.value = s.freq ?? 1900;
    f.Q.value = s.q ?? 1.1;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    n.connect(f); f.connect(g); n.start(t); n.stop(t + dec + 0.02);

    if (s.body){
      const b = s.body, bd = b.decay ?? 0.12;
      const o = c.createOscillator(); o.type = b.wave ?? 'triangle'; o.frequency.value = b.freq ?? 185;
      const og = c.createGain();
      og.gain.setValueAtTime(v * (b.gain ?? 0.4), t);
      og.gain.exponentialRampToValueAtTime(0.001, t + bd);
      o.connect(og); og.connect(g); o.start(t); o.stop(t + bd + 0.02);
    }
  }

  /** Inharmonic square bank through a highpass — 808 cymbals, cowbells, glass. */
  _vMetal(g, t, v, s){
    const c = this.ctx;
    const base = s.base ?? 320, dec = s.decay ?? 0.3;
    const ratios = s.ratios ?? [1, 1.41, 1.68, 1.94, 2.37, 2.83];
    const f = c.createBiquadFilter();
    f.type = s.filter ?? 'highpass'; f.frequency.value = s.freq ?? 6000; f.Q.value = s.q ?? 0.7;
    g.gain.setValueAtTime(v * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    for (const r of ratios){
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = base * r;
      o.connect(f); o.start(t); o.stop(t + dec + 0.02);
    }
    f.connect(g);
  }

  /* ───────── pinch voice ───────── */

  /** Returns a handle so a live pinch can be bent and released later. */
  note(midi, when, cutoff = 1600, vel = 0.7, dur = null){
    const spec = this.kit?.lead ?? { type: 'saw3' };
    const c = this.ctx, t = when ?? c.currentTime;
    const hz = mtof(midi);
    const rel = spec.release ?? 0.25;

    const g = c.createGain(); g.gain.value = 0;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = spec.q ?? 7;
    f.frequency.setValueAtTime(Math.max(300, cutoff), t);
    f.connect(g);
    this._tap(g, spec.send ?? 0.5);

    const oscs = [];
    const osc = (type, freq, detune = 0, gain = 1) => {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      if (gain === 1) o.connect(f);
      else { const og = c.createGain(); og.gain.value = gain; o.connect(og); og.connect(f); }
      o.start(t); oscs.push(o); return o;
    };

    switch (spec.type){
      case 'fm': {
        const car = osc('sine', hz);
        const m = c.createOscillator(); m.type = 'sine';
        m.frequency.value = hz * (spec.ratio ?? 2);
        const mg = c.createGain();
        const idx = (spec.index ?? 3) * hz;
        mg.gain.setValueAtTime(idx, t);
        mg.gain.setTargetAtTime(idx * (spec.indexEnd ?? 0.15), t, spec.indexDecay ?? 0.35);
        m.connect(mg); mg.connect(car.frequency); m.start(t); oscs.push(m);
        break;
      }
      case 'organ':
        osc('sine', hz); osc('sine', hz * 2, 0, 0.45); osc('sine', hz * 3, 0, 0.22);
        break;
      case 'pluck':
        osc('sawtooth', hz); osc('sawtooth', hz, spec.detune ?? 9, 0.7);
        f.frequency.setValueAtTime(Math.max(300, cutoff) * (spec.sweep ?? 3.2), t);
        f.frequency.setTargetAtTime(Math.max(300, cutoff), t, spec.sweepTime ?? 0.09);
        break;
      default:  // saw3 — two detuned saws over a sub
        osc('sawtooth', hz);
        osc('sawtooth', hz, spec.detune ?? 7);
        if (spec.sub !== 0) osc('sine', hz / 2, 0, spec.sub ?? 1);
        break;
    }

    const atk  = spec.attack ?? 0.02;
    const peak = vel * (spec.level ?? 0.30);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    if (spec.decay) g.gain.setTargetAtTime(peak * (spec.sustain ?? 0.6), t + atk, spec.decay);

    let stopped = false;
    const stop = (at) => {
      if (stopped) return;
      stopped = true;
      const e = Math.max(at ?? c.currentTime, t);
      if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(e);
      else g.gain.cancelScheduledValues(e);
      // setTarget rather than an exponential ramp: the gain may legitimately be
      // at zero if the pinch is released inside the attack, and an exponential
      // ramp from zero is a no-op that leaves the voice droning.
      g.gain.setTargetAtTime(0, e, rel / 3);
      for (const o of oscs){ try { o.stop(e + rel + 0.05); } catch (_){} }
    };
    if (dur != null) stop(t + dur);
    return { stop, filter: f };
  }
}
