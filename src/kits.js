/* Kit loading. Kits are data files; adding one means dropping JSON into
 * ./kits and naming it in index.json. Nothing here needs to change. */

/* If the fetch fails the instrument still plays, same pattern as face
 * tracking. This is the only kit that lives in code. */
const BUILTIN = {
  id: 'builtin', name: 'Moon',
  scale: [57, 60, 62, 64, 67, 69, 72, 74, 76, 79],
  lead: { type: 'saw3', detune: 7, sub: 1, q: 7, level: 0.30, attack: 0.02, release: 0.25 },
  pads: [
    { name: 'kick',  color: '#ff7a4d', gm: 36, voice: 'body',
      from: 140, to: 44, drop: 0.14, decay: 0.45, gain: 1.0 },
    { name: 'snare', color: '#ffc24d', gm: 38, voice: 'noise',
      filter: 'bandpass', freq: 1900, q: 1.1, decay: 0.20, gain: 0.85,
      body: { wave: 'triangle', freq: 185, gain: 0.4, decay: 0.12 } },
    { name: 'hat',   color: '#9dff6b', gm: 42, voice: 'noise',
      filter: 'highpass', freq: 7200, decay: 0.06, gain: 0.40 },
    { name: 'clap',  color: '#5ce1ff', gm: 39, voice: 'noise',
      filter: 'bandpass', freq: 1150, q: 2.4, decay: 0.26, gain: 0.85 },
    { name: 'tom',   color: '#b98bff', gm: 45, voice: 'body',
      from: 240, to: 110, drop: 0.24, decay: 0.35, gain: 0.90 },
  ],
};

const ok = k => k && Array.isArray(k.pads) && k.pads.length >= 1;

export async function loadKits(base = './kits'){
  try {
    const names = await (await fetch(`${base}/index.json`)).json();
    const kits = (await Promise.all(names.map(async n => {
      try { return await (await fetch(`${base}/${n}.json`)).json(); }
      catch (_){ return null; }
    }))).filter(ok);
    return kits.length ? kits : [BUILTIN];
  } catch (_){
    return [BUILTIN];
  }
}
