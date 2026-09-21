/* Type-1 MIDI export: one track per layer, so a take opens in a DAW already
 * split the way it was played. Drums go to channel 10, notes to channel 1. */

const PPQ = 480;
const DRUM_CH = 9, NOTE_CH = 0;
const DRUM_TICKS = 30;

class Bytes {
  constructor(){ this.a = []; }
  u8(...v){ for (const x of v) this.a.push(x & 255); return this; }
  u16(v){ return this.u8(v >> 8, v); }
  u32(v){ return this.u8(v >>> 24, v >>> 16, v >>> 8, v); }
  str(s){ for (let i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i) & 255); return this; }
  vlq(n){
    n = Math.max(0, Math.round(n));
    const out = [n & 0x7f];
    n = Math.floor(n / 128);
    while (n > 0){ out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    return this.u8(...out);
  }
  raw(arr){ for (const b of arr) this.a.push(b & 255); return this; }
}

function chunk(id, body){
  const b = new Bytes().str(id).u32(body.length).raw(body);
  return b.a;
}

/** events: [{ tick, prio, bytes }] — prio 0 sorts note-off ahead of note-on. */
function track(events, endTick){
  events.sort((a, b) => a.tick - b.tick || a.prio - b.prio);
  const b = new Bytes();
  let last = 0;
  for (const e of events){
    b.vlq(e.tick - last).raw(e.bytes);
    last = e.tick;
  }
  b.vlq(Math.max(0, endTick - last)).u8(0xff, 0x2f, 0x00);
  return chunk('MTrk', b.a);
}

const vel7 = v => Math.max(1, Math.min(127, Math.round((v ?? 0.7) * 99) + 28));

export function loopToMidi(loop, kit){
  const toTick = s => Math.max(0, Math.round(s * PPQ * loop.bpm / 60));
  const endTick = toTick(loop.length);
  const mpq = Math.round(60000000 / loop.bpm);

  /* conductor track */
  const meta = [];
  const name = `Handspace — ${kit?.name ?? 'kit'}`;
  meta.push({ tick: 0, prio: 0, bytes: new Bytes().u8(0xff, 0x03).vlq(name.length).str(name).a });
  meta.push({ tick: 0, prio: 1, bytes: [0xff, 0x51, 0x03, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] });
  meta.push({ tick: 0, prio: 2, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] });

  const tracks = [track(meta, endTick)];

  loop.layers.forEach((layer, li) => {
    if (!layer.events.length) return;
    const ev = [];
    const title = `Layer ${li + 1}`;
    ev.push({ tick: 0, prio: 0, bytes: new Bytes().u8(0xff, 0x03).vlq(title.length).str(title).a });

    let usesNotes = false;
    for (const e of layer.events){
      const on = toTick(e.t);
      if (e.kind === 'drum'){
        const spec = kit?.pads?.[e.pad];
        const note = spec?.gm ?? (36 + e.pad);
        ev.push({ tick: on, prio: 1, bytes: [0x90 | DRUM_CH, note, vel7(e.vel)] });
        ev.push({ tick: Math.min(on + DRUM_TICKS, endTick), prio: 0, bytes: [0x80 | DRUM_CH, note, 0] });
      } else {
        usesNotes = true;
        const off = Math.min(on + Math.max(60, toTick(e.dur ?? 0.4)), endTick);
        ev.push({ tick: on,  prio: 1, bytes: [0x90 | NOTE_CH, e.midi & 127, vel7(e.vel)] });
        ev.push({ tick: off, prio: 0, bytes: [0x80 | NOTE_CH, e.midi & 127, 0] });
      }
    }
    if (usesNotes) ev.push({ tick: 0, prio: 0, bytes: [0xC0 | NOTE_CH, 81] });  // GM lead 2 (sawtooth)

    tracks.push(track(ev, endTick));
  });

  const head = chunk('MThd', new Bytes().u16(1).u16(tracks.length).u16(PPQ).a);
  const total = head.length + tracks.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of [head, ...tracks]){ out.set(part, o); o += part.length; }
  return out;
}

export function downloadMidi(loop, kit, filename){
  if (!loop.count) return false;
  const blob = new Blob([loopToMidi(loop, kit)], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? `handspace-${Date.now()}.mid`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
