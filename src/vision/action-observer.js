function actionKey(handId, street, fingerprint = '') {
  return `${handId}:${street || '-'}:${fingerprint || '-'}`;
}

export class ActionObserver {
  constructor() {
    this.busy = false;
    this.enabled = true;
    this.generation = 0;
    this.controller = null;
    this.lastReadAt = 0;
    this.minIntervalMs = 1600;
    this.lastKey = null;
    this.lastError = null;
    try { this.accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch { this.accessToken = ''; }
  }

  setAccessToken(token) {
    this.accessToken = String(token || '').trim();
    this.resetSession();
  }

  resetSession() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.lastReadAt = 0;
    this.lastKey = null;
    this.lastError = null;
    this.enabled = true;
  }

  resetHand() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
    this.lastKey = null;
    this.lastError = null;
  }

  shouldRead(handId, street, now = performance.now()) {
    if (!this.enabled || this.busy || !this.accessToken || !Number.isInteger(handId) || handId <= 0) return false;
    return now - this.lastReadAt >= this.minIntervalMs;
  }

  async read(canvas, handId, street, { fingerprint = '' } = {}) {
    const now = performance.now();
    if (!this.shouldRead(handId, street, now)) return null;
    const key = actionKey(handId, street, fingerprint);
    const generation = this.generation;
    this.busy = true;
    this.lastReadAt = now;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const image = canvas.toDataURL('image/jpeg', 0.72);
      const timer = setTimeout(() => controller.abort(), 7000);
      let r;
      try {
        r = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-coach-token': this.accessToken },
          body: JSON.stringify({ kind: 'action_log', image, handId, street, fingerprint }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (generation !== this.generation) return null;
      if (!r.ok) {
        this.lastError = `HTTP ${r.status}`;
        if ([401,404,501].includes(r.status)) this.enabled = false;
        return null;
      }
      const out = await r.json();
      if (generation !== this.generation) return null;
      this.lastError = null;
      this.lastKey = key;
      return out;
    } catch (e) {
      if (generation !== this.generation) return null;
      this.lastError = e?.name === 'AbortError' ? 'timeout' : 'request-error';
      return null;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (this.controller === controller) this.controller = null;
      }
    }
  }
}
