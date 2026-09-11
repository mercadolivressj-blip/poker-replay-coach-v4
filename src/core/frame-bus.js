export class FrameBus {
  constructor(getSource, { maxFps = 30 } = {}) {
    this.getSource = getSource;
    this.maxFps = maxFps;
    this.handlers = [];
    this.errorHandlers = [];
    this.running = false;
    this.seq = 0;
    this.last = 0;
    this.canvas = document.createElement('canvas');
  }

  on(fn) {
    this.handlers.push(fn);
    return () => (this.handlers = this.handlers.filter((x) => x !== fn));
  }

  onError(fn) {
    this.errorHandlers.push(fn);
    return () => (this.errorHandlers = this.errorHandlers.filter((x) => x !== fn));
  }

  #report(error, phase = 'frame-handler') {
    if (!this.errorHandlers.length) {
      console.error(`[FrameBus:${phase}]`, error);
      return;
    }
    for (const fn of this.errorHandlers) {
      try { fn(error, phase); } catch {}
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (ts) => {
      if (!this.running) return;
      // Queue the next animation frame before detector work. A single sensor
      // exception can no longer freeze the entire coach and leave stale UI.
      requestAnimationFrame(loop);
      try {
        const min = 1000 / this.maxFps;
        if (ts - this.last < min) return;
        this.last = ts;
        const src = this.getSource();
        const w = src?.videoWidth || src?.naturalWidth || 0;
        const h = src?.videoHeight || src?.naturalHeight || 0;
        if (!w || !h) return;
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
        }
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0, w, h);
        const frame = { seq: ++this.seq, ts: performance.now(), canvas: this.canvas, w, h };
        for (const fn of this.handlers) {
          try { fn(frame); } catch (error) { this.#report(error); }
        }
      } catch (error) {
        this.#report(error, 'frame-capture');
      }
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }
}
