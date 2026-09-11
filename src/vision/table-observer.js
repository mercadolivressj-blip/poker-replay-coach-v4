export class TableObserver {
  constructor() {
    this.busy = false;
    this.enabled = true;
    this.generation = 0;
    this.controller = null;
    this.lastReadAt = 0;
    this.minIntervalMs = 850;
    this.lastError = null;
    this.last = null;
    try { this.accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch { this.accessToken = ''; }
    if (typeof window !== 'undefined') window.__prcTableObserver = this;
  }

  setAccessToken(token) {
    const next = String(token || '').trim();
    if (next === this.accessToken) return;
    this.accessToken = next;
    this.resetSession();
  }

  resetSession() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.lastReadAt = 0;
    this.lastError = null;
    this.last = null;
    this.enabled = true;
  }

  resetHand() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.lastReadAt = 0;
    this.lastError = null;
    this.last = null;
    this.enabled = true;
  }

  shouldRead(handId, now = performance.now()) {
    if (!this.enabled || this.busy || !Number.isInteger(handId) || handId <= 0) return false;
    return now - this.lastReadAt >= this.minIntervalMs;
  }

  async read(canvas, handId, street, { fingerprint = '' } = {}) {
    const now = performance.now();
    if (!this.shouldRead(handId, now)) return null;
    const generation = this.generation;
    this.busy = true;
    this.lastReadAt = now;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const image = canvas.toDataURL('image/jpeg', 0.70);
      const r = await fetch('/api/table-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.accessToken ? { 'x-coach-token': this.accessToken } : {}) },
        body: JSON.stringify({ mode: 'replay', image, handId, street, fingerprint }),
        signal: controller.signal,
      });
      if (generation !== this.generation) return null;
      if (!r.ok) {
        this.lastError = `HTTP ${r.status}`;
        if ([401,404,501].includes(r.status)) this.enabled = false;
        return null;
      }
      const out = await r.json();
      if (generation !== this.generation || out?.handId !== handId) return null;
      this.lastError = null;
      this.last = out;
      return out;
    } catch (e) {
      if (generation !== this.generation) return null;
      this.lastError = e?.name === 'AbortError' ? 'timeout' : 'request-error';
      return null;
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.busy = false;
        if (this.controller === controller) this.controller = null;
      }
    }
  }
}
