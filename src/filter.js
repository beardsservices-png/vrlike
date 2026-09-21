/* One Euro filter — Casiez, Roussel & Vogel (CHI 2012).
 *
 * A fixed lerp has to pick: follow fast and jitter, or sit still and lag.
 * One Euro widens its own cutoff with the observed speed, so a slow hand gets
 * heavy smoothing (a quiet cursor) and a fast one gets almost none (a strike
 * that lands when it looks like it lands).
 */

const alphaFor = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class LowPass {
  constructor(){ this.s = null; }
  filter(x, a){
    this.s = this.s === null ? x : a * x + (1 - a) * this.s;
    return this.s;
  }
  reset(){ this.s = null; }
}

export class OneEuro {
  /** @param minCutoff Hz — lower is steadier at rest. beta — higher follows speed harder. */
  constructor({ minCutoff = 1.4, beta = 0.05, dCutoff = 1.0 } = {}){
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xf = new LowPass();
    this.dxf = new LowPass();
    this.prev = null;
    this.tPrev = null;
  }
  reset(){ this.xf.reset(); this.dxf.reset(); this.prev = null; this.tPrev = null; }
  /** @param t seconds, monotonic */
  filter(v, t){
    if (this.tPrev === null){
      this.tPrev = t; this.prev = v;
      this.xf.filter(v, 1);
      return v;
    }
    // A hand that reappears after a long gap should snap, not slide in from
    // wherever it was last seen — hence the dt ceiling.
    const dt = Math.min(0.25, Math.max(1e-3, t - this.tPrev));
    this.tPrev = t;
    const dv = (v - this.prev) / dt;
    this.prev = v;
    const edv = this.dxf.filter(dv, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edv);
    return this.xf.filter(v, alphaFor(cutoff, dt));
  }
}

/** A bank of independent One Euro filters, one per named channel. */
export class OneEuroBank {
  constructor(channels){
    this.f = {};
    for (const [name, opts] of Object.entries(channels)) this.f[name] = new OneEuro(opts);
  }
  filter(values, t){
    const out = {};
    for (const k in this.f) out[k] = this.f[k].filter(values[k], t);
    return out;
  }
  reset(){ for (const k in this.f) this.f[k].reset(); }
}
