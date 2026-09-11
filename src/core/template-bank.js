import { vectorDistance } from './image.js';
export class TemplateBank {
  constructor(key = 'prc.v4.2.templates') { this.key = key; this.db = this.load(); }
  load() { try { const parsed = JSON.parse(localStorage.getItem(this.key) || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.db)); } catch {} }
  learn(label, vector, weight = 1) {
    if (!label || !vector?.length) return;
    const arr = this.db[label] || []; let near = null;
    for (const it of arr) { const d = vectorDistance(vector, it.v); if (d < 0.035 && (!near || d < near.d)) near = { it, d }; }
    if (near) {
      const oldW = near.it.w || 1, addW = Math.max(0.2, weight), total = Math.min(8, oldW + addW);
      near.it.v = near.it.v.map((x, i) => (x * oldW + vector[i] * addW) / (oldW + addW)); near.it.w = total;
    } else { arr.push({ v: Array.from(vector), w: Math.max(0.2, weight) }); if (arr.length > 10) arr.shift(); }
    this.db[label] = arr; this.save();
  }
  classify(vector, labels = null) {
    let best = null, second = null;
    for (const [label, items] of Object.entries(this.db)) {
      if (labels && !labels.includes(label)) continue;
      for (const it of items) {
        const raw = vectorDistance(vector, it.v), d = raw / Math.min(1.12, 0.92 + (it.w || 1) * 0.025), r = { label, d, raw };
        if (!best || d < best.d) { second = best; best = r; } else if (!second || d < second.d) second = r;
      }
    }
    if (!best) return { label: null, confidence: 0, distance: 1 };
    const margin = second ? Math.max(0, second.d - best.d) : 0.16;
    const confidence = Math.max(0, Math.min(1, 1 - best.raw * 2.15 + margin * 1.2));
    return { label: confidence > 0.8 && best.raw < 0.14 ? best.label : null, confidence, distance: best.raw };
  }
  counts() { return Object.fromEntries(Object.entries(this.db).map(([k, v]) => [k, v.length])); }
  clear() { this.db = {}; try { localStorage.removeItem(this.key); } catch {} }
}
