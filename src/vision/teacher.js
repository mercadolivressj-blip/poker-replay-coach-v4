function freezeKey(kind, handId, expectedCount, fingerprint = '') { return `${kind}:${handId}:${expectedCount ?? '-'}:${fingerprint || '-'}`; }
export class VisionTeacher {
  constructor() {
    this.busy = false; this.last = null; this.enabled = true; this.done = new Set(); this.attempts = new Map(); this.lastError = null; this.generation = 0; this.controller = null;
    try { this.accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch { this.accessToken = ''; }
  }
  setAccessToken(token) {
    this.accessToken = String(token || '').trim();
    try { if (this.accessToken) sessionStorage.setItem('prc.vision-token', this.accessToken); else sessionStorage.removeItem('prc.vision-token'); } catch {}
    this.resetSession();
  }
  resetSession() {
    this.generation++; this.controller?.abort(); this.controller = null; this.busy = false; this.last = null; this.done.clear(); this.attempts.clear(); this.lastError = null; this.enabled = true;
  }
  resetHand(handId) {
    this.generation++; this.controller?.abort(); this.controller = null; this.busy = false; this.last = null; this.lastError = null;
    for (const k of this.done) if (!k.includes(`:${handId}:`)) this.done.delete(k);
    for (const k of this.attempts.keys()) if (!k.includes(`:${handId}:`)) this.attempts.delete(k);
  }
  shouldRead(kind, handId, expectedCount, fingerprint = '') {
    const key = freezeKey(kind, handId, expectedCount, fingerprint); return this.enabled && !this.done.has(key) && (this.attempts.get(key) || 0) < 2;
  }
  async read(kind, canvas, handId, { expectedCount = null, fingerprint = '' } = {}) {
    const key = freezeKey(kind, handId, expectedCount, fingerprint);
    if (this.busy || !this.shouldRead(kind, handId, expectedCount, fingerprint)) return null;
    const generation = this.generation; this.busy = true; this.attempts.set(key, (this.attempts.get(key) || 0) + 1);
    const controller = new AbortController(); this.controller = controller;
    try {
      const image = canvas.toDataURL('image/jpeg', 0.86), timer = setTimeout(() => controller.abort(), 9000); let r;
      try { r = await fetch('/api/vision', { method: 'POST', headers: { 'content-type': 'application/json', ...(this.accessToken ? { 'x-coach-token': this.accessToken } : {}) }, body: JSON.stringify({ kind, image, handId, expectedCount, fingerprint }), signal: controller.signal }); }
      finally { clearTimeout(timer); }
      if (generation !== this.generation) return null;
      if (!r.ok) { this.lastError = `HTTP ${r.status}`; if (r.status === 401 || r.status === 404 || r.status === 501) this.enabled = false; return null; }
      const out = await r.json(); if (generation !== this.generation) return null; this.last = out; this.lastError = null;
      const minCard = Math.min(1, ...(out.cards || []).map((c) => Number(c.confidence) || 0)); if (Number(out.confidence) >= 0.82 && minCard >= 0.75) this.done.add(key); return out;
    } catch (e) { if (generation !== this.generation) return null; this.lastError = e?.name === 'AbortError' ? 'timeout' : 'request-error'; return null; }
    finally { if (generation === this.generation) { this.busy = false; if (this.controller === controller) this.controller = null; } }
  }
}
