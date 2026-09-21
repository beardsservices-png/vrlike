/* Loop transport: four independent layers over a shared 2-bar grid,
 * driven by a lookahead scheduler rather than by timers. */

export const LAYERS = 4;
export const LAYER_COLORS = [0xff7a4d, 0x5ce1ff, 0x9dff6b, 0xb98bff];

const LOOKAHEAD = 0.15;   // seconds of audio scheduled past "now"

export class Loop {
  constructor(engine, { bpm = 96, bars = 2, steps = 32 } = {}){
    this.e = engine;
    this.bpm = bpm;
    this.bars = bars;
    this.steps = steps;
    this.length = (60 / bpm) * 4 * bars;
    this.layers = Array.from({ length: LAYERS }, (_, i) => ({
      events: [], muted: false, color: LAYER_COLORS[i],
    }));
    this.active = 0;
    this.recording = false;
    this.playing = false;
    this.origin = 0;
    this.cursor = 0;
    this._dirty = true;   // step-ring cache
    this._marks = null;
  }

  get stepLen(){ return this.length / this.steps; }
  get count(){ return this.layers.reduce((n, l) => n + l.events.length, 0); }

  start(){
    this.origin = this.e.ctx.currentTime;
    this.cursor = this.origin;
    this.playing = true;
  }
  stop(){ this.playing = false; this.recording = false; }

  phase(){
    if (!this.playing) return 0;
    return ((this.e.ctx.currentTime - this.origin) % this.length) / this.length;
  }
  quantize(t){ const q = this.stepLen; return (Math.round(t / q) * q) % this.length; }

  setActive(i){ this.active = ((i % LAYERS) + LAYERS) % LAYERS; }
  toggleMute(i = this.active){ this.layers[i].muted = !this.layers[i].muted; this._dirty = true; }
  clear(i = this.active){ this.layers[i].events.length = 0; this._dirty = true; }
  clearAll(){ for (const l of this.layers) l.events.length = 0; this._dirty = true; }

  /** Overdub onto the active layer. */
  capture(ev){
    if (!this.recording || !this.playing) return;
    const elapsed = this.e.ctx.currentTime - this.origin;
    const raw = elapsed % this.length;
    const cycle = Math.floor(elapsed / this.length);
    const t = this.quantize(raw);
    // A hit late in the bar can quantize forward past the loop point, in which
    // case it belongs to the next cycle. Either way the player already heard it
    // live, so remember which cycle that was and do not play it again there.
    const born = (t < raw - this.length / 2) ? cycle + 1 : cycle;
    this.layers[this.active].events.push({ ...ev, t, born, layer: this.active });
    this._dirty = true;
  }

  fire(ev, when){
    if (ev.kind === 'drum') this.e.drum(ev.pad, when, ev.vel);
    else this.e.note(ev.midi, when, ev.cutoff, ev.vel, ev.dur ?? 0.35);
  }

  /** Call once per animation frame. */
  tick(){
    if (!this.playing) return;
    const now = this.e.ctx.currentTime;
    const ahead = now + LOOKAHEAD;
    if (this.cursor < now) this.cursor = now;   // recover from a stalled tab

    for (const layer of this.layers){
      if (layer.muted) continue;
      for (const ev of layer.events){
        const cycle = Math.ceil((this.cursor - this.origin - ev.t) / this.length);
        if (cycle <= ev.born) continue;         // the live hit covered this pass
        const when = this.origin + cycle * this.length + ev.t;
        if (when >= this.cursor && when < ahead) this.fire(ev, when);
      }
    }
    this.cursor = ahead;
  }

  /** Per-step layer occupancy for the ring, rebuilt only when events change. */
  marks(){
    if (!this._dirty && this._marks) return this._marks;
    const m = Array.from({ length: this.steps }, () => []);
    this.layers.forEach((layer, li) => {
      if (!layer.events.length) return;
      for (const ev of layer.events){
        const s = Math.round(ev.t / this.stepLen) % this.steps;
        if (!m[s].includes(li)) m[s].push(li);
      }
    });
    this._dirty = false;
    this._marks = m;
    return m;
  }

  /* ───────── serialisation ───────── */

  serialize(){
    return {
      bpm: this.bpm, bars: this.bars, steps: this.steps,
      layers: this.layers.map(l => ({
        muted: l.muted,
        events: l.events.map(({ born, layer, ...keep }) => keep),
      })),
    };
  }

  load(data){
    if (!data?.layers) return false;
    this.clearAll();
    data.layers.slice(0, LAYERS).forEach((src, i) => {
      this.layers[i].muted = !!src.muted;
      // born = -1: a loaded event was never heard live, so it plays from the first pass.
      this.layers[i].events = (src.events ?? []).map(ev => ({ ...ev, born: -1, layer: i }));
    });
    this._dirty = true;
    return true;
  }
}
