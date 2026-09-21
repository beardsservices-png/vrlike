/* Everything outside the WebGL canvas. */

import { LAYER_COLORS, LAYERS } from './loop.js';

const byId = id => document.getElementById(id);
const hex  = n => '#' + n.toString(16).padStart(6, '0');
const clock = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export class UI {
  constructor(handlers = {}){
    this.h = handlers;
    this.el = {
      mode: byId('mode'), kit: byId('kitname'), chips: byId('chips'),
      loop: byId('loopinfo'), fps: byId('fps'), toast: byId('toast'),
      takes: byId('takes'), strip: byId('takeStrip'), save: byId('saveTake'),
      preview: byId('preview'), video: byId('cam'), campick: byId('campick'),
    };
    this.pctx = this.el.preview.getContext('2d');
    this._toastTimer = 0;

    this.chips = [];
    for (let i = 0; i < LAYERS; i++){
      const c = document.createElement('i');
      c.textContent = String(i + 1);
      this.el.chips.appendChild(c);
      this.chips.push(c);
    }
    this.el.save.addEventListener('click', () => this.h.onSaveTake?.());
    this.el.campick.addEventListener('change', e => this.h.onPickCamera?.(e.target.value));
  }

  /** Only shown when there is a real choice to make. */
  setCameras(list, currentId){
    this.el.campick.replaceChildren();
    for (const c of list){
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = (c.virtual ? '⚠ ' : '') + c.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '');
      o.selected = c.id === currentId;
      this.el.campick.appendChild(o);
    }
    this.el.campick.classList.toggle('hidden', list.length < 2);
  }

  selectCamera(id){ this.el.campick.value = id; }

  show(){ this.el.takes.classList.remove('hidden'); this.el.preview.classList.remove('hidden'); }

  toast(msg, ms = 1800){
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }

  setMode(loop, kitName){
    this.el.mode.textContent = !loop.playing ? 'stopped' : (loop.recording ? 'recording' : 'playing');
    this.el.mode.style.color = loop.recording ? 'var(--rec)' : (loop.playing ? 'var(--go)' : '');
    this.el.kit.textContent = kitName ?? '';
    const n = loop.count;
    this.el.loop.textContent = `${n} event${n === 1 ? '' : 's'}`;
    loop.layers.forEach((layer, i) => {
      const c = this.chips[i];
      const on = i === loop.active;
      c.textContent = layer.events.length ? `${i + 1}·${layer.events.length}` : String(i + 1);
      c.classList.toggle('on', on);
      c.classList.toggle('muted', layer.muted);
      c.style.background = on ? hex(LAYER_COLORS[i]) : '';
    });
  }

  setFps(n){ this.el.fps.textContent = n; }

  renderTakes(takes){
    this.el.strip.replaceChildren();
    for (const t of takes){
      const row = document.createElement('div');
      row.className = 'take';

      const load = document.createElement('button');
      load.className = 'name';
      load.type = 'button';
      load.textContent = t.name;
      load.title = `Load "${t.name}" — saved ${clock(t.ts)}`;
      load.addEventListener('click', () => this.h.onLoadTake?.(t.id));

      const kill = document.createElement('button');
      kill.className = 'kill';
      kill.type = 'button';
      kill.textContent = '×';
      kill.title = 'Delete this take';
      kill.setAttribute('aria-label', `Delete ${t.name}`);
      kill.addEventListener('click', () => this.h.onDeleteTake?.(t.id));

      row.append(load, kill);
      this.el.strip.appendChild(row);
    }
  }

  togglePreview(){ this.el.preview.classList.toggle('hidden'); }

  drawPreview(landmarks){
    const p = this.el.preview, v = this.el.video;
    if (p.classList.contains('hidden') || v.readyState < 2) return;
    const ctx = this.pctx;
    ctx.save();
    ctx.translate(p.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, p.width, p.height);
    ctx.fillStyle = '#ff7a4d';
    for (const lm of landmarks){
      for (const pt of lm){
        ctx.beginPath();
        ctx.arc(pt.x * p.width, pt.y * p.height, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
