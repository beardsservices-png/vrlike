/* Calibration: learn this player's reach once, keep it forever.
 *
 * The prototype hardcoded a palm-span range of 0.085 to 0.24. That number is a
 * property of a particular camera, lens and arm, and everything downstream —
 * where the strike plane sits, how hard a punch reads — inherits its error.
 * Two held poses fix it. */

const HOLD_MS  = 1500;   // "get into position"
const REACH_MS = 4000;   // sampling window

const STAGES = [
  { ms: HOLD_MS,  title: 'Palm to the screen',
    hint: 'Reach out as if you were pressing the glass, and hold it there.' },
  { ms: REACH_MS, bucket: 'near', title: 'Hold it',
    hint: 'Keep your palm out toward the camera.' },
  { ms: HOLD_MS,  title: 'Now back to your chest',
    hint: 'Bring the same hand in, elbow bent, palm still facing the camera.' },
  { ms: REACH_MS, bucket: 'far', title: 'Hold it',
    hint: 'Keep your hand in close.' },
];

const MIN_SAMPLES = 12;
const MIN_RATIO   = 1.30;   // near span must be meaningfully bigger than far

const median = a => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const byId = id => document.getElementById(id);

export class Calibration {
  constructor(){
    this.el = {
      root:  byId('calib'),
      title: byId('calibTitle'),
      body:  byId('calibBody'),
      fill:  byId('calibFill'),
      near:  byId('tickNear'),
      far:   byId('tickFar'),
      hint:  byId('calibHint'),
      count: byId('calibCount'),
      go:    byId('calibGo'),
      skip:  byId('calibSkip'),
      readout: byId('calibHint').parentElement,
    };
    this.phase = 'off';
    this._resolve = null;
    this.el.go.addEventListener('click', () => this._begin());
    this.el.skip.addEventListener('click', () => this._finish(null));
  }

  get active(){ return this.phase !== 'off'; }

  /** @returns Promise<{near,far}|null> — null means the player skipped. */
  open({ redo = false } = {}){
    this.phase = 'idle';
    this.el.root.classList.remove('hidden');
    this.el.go.disabled = true;
    this.el.go.textContent = 'Start';
    this.el.title.textContent = redo ? 'Calibrate again' : 'Two quick reaches';
    this.el.body.textContent = redo
      ? 'Same two poses. The new reading replaces the old one.'
      : 'This teaches Handspace how far your arms go, so the pads sit where they feel like they should. Ten seconds, once.';
    this.el.readout.classList.remove('err');
    this.el.near.classList.remove('set');
    this.el.far.classList.remove('set');
    this.el.count.textContent = '';
    this._resetRun();
    return new Promise(res => { this._resolve = res; });
  }

  _resetRun(){
    this.stage = 0;
    this.acc = 0;
    this.last = null;
    this.samples = { near: [], far: [] };
    this.lo = Infinity;
    this.hi = -Infinity;
  }

  _begin(){
    this._resetRun();
    this.phase = 'run';
    this.el.go.disabled = true;
    this.el.readout.classList.remove('err');
  }

  /** Called once per animation frame with the current hand read. */
  feed(hands, nowMs){
    if (this.phase === 'off') return;
    const h = hands.find(Boolean);
    if (h) this._meter(h.span);

    if (this.phase === 'idle'){
      this.el.go.disabled = !h;
      this.el.hint.textContent = h
        ? 'Good — one hand is in frame. Press start.'
        : 'Show one hand to the camera.';
      return;
    }

    const dt = this.last === null ? 0 : Math.min(200, nowMs - this.last);
    this.last = nowMs;

    const stage = STAGES[this.stage];
    this.el.title.textContent = stage.title;

    if (stage.bucket){
      if (!h){
        // Pause rather than burning the window while the hand is out of frame.
        this.el.hint.textContent = 'Lost your hand — bring it back into frame.';
        this.el.count.textContent = '';
        return;
      }
      this.samples[stage.bucket].push(h.span);
    }
    this.el.hint.textContent = stage.hint;

    this.acc += dt;
    this.el.count.textContent = `${Math.ceil((stage.ms - this.acc) / 1000)}s`;

    if (this.acc < stage.ms) return;

    if (stage.bucket === 'near') this.el.near.classList.add('set');
    if (stage.bucket === 'far')  this.el.far.classList.add('set');

    this.acc = 0;
    this.stage++;
    if (this.stage < STAGES.length) return;

    this._evaluate();
  }

  _evaluate(){
    const near = median(this.samples.near);
    const far  = median(this.samples.far);
    const enough = this.samples.near.length >= MIN_SAMPLES && this.samples.far.length >= MIN_SAMPLES;

    if (!enough || !(near > 0) || !(far > 0) || near / far < MIN_RATIO){
      this.phase = 'idle';
      this.el.go.disabled = false;
      this.el.go.textContent = 'Try again';
      this.el.title.textContent = 'That did not read';
      this.el.readout.classList.add('err');
      this.el.hint.textContent = !enough
        ? 'Your hand was out of frame too often. Keep it visible the whole time.'
        : 'The two poses looked the same. Reach further out, then bring it right in.';
      this.el.count.textContent = '';
      this.el.near.classList.remove('set');
      this.el.far.classList.remove('set');
      return;
    }

    // A little headroom past each pose, so the ends of the range stay reachable
    // without the player straining to hit them.
    this._finish({ near: near * 1.04, far: far * 0.96 });
  }

  _meter(span){
    this.lo = Math.min(this.lo, span);
    this.hi = Math.max(this.hi, span);
    const range = this.hi - this.lo;
    const pct = range > 1e-4 ? ((span - this.lo) / range) * 100 : 0;
    this.el.fill.style.width = `${pct.toFixed(1)}%`;
    const place = (el, v) => {
      if (range > 1e-4) el.style.left = `${(((v - this.lo) / range) * 100).toFixed(1)}%`;
    };
    if (this.samples.near.length) place(this.el.near, median(this.samples.near));
    if (this.samples.far.length)  place(this.el.far,  median(this.samples.far));
  }

  _finish(result){
    this.phase = 'off';
    this.el.root.classList.add('hidden');
    const r = this._resolve;
    this._resolve = null;
    r?.(result);
  }
}
