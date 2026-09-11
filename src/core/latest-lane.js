/**
 * Single-flight async lane with latest-wins backpressure. If OCR is already
 * running, old intermediate frames are discarded and only the newest job is
 * retained. A lane failure is isolated and cannot poison later frames.
 */
export class LatestLane {
  constructor(name = 'lane', onError = null) {
    this.name = name;
    this.onError = onError;
    this.busy = false;
    this.pending = null;
    this.runs = 0;
    this.dropped = 0;
    this.errors = 0;
    this.lastMs = null;
  }

  setErrorHandler(fn) {
    this.onError = fn;
    return this;
  }

  schedule(job) {
    if (this.busy) {
      if (this.pending) this.dropped++;
      this.pending = job;
      return;
    }
    void this.#run(job);
  }

  // Backwards-compatible alias used by the standalone runtime. Keeping this
  // contract explicit prevents a UI/runtime build mismatch from killing every
  // downstream detector before actions/pot/board can run.
  run(job) {
    return this.schedule(job);
  }

  async #run(job) {
    this.busy = true;
    this.runs++;
    const t0 = performance.now();
    try {
      await job();
    } catch (error) {
      this.errors++;
      if (this.onError) {
        try { this.onError(error, this.name); } catch {}
      } else {
        console.error(`[LatestLane:${this.name}]`, error);
      }
    } finally {
      this.lastMs = Math.round(performance.now() - t0);
      this.busy = false;
      const next = this.pending;
      this.pending = null;
      if (next) void this.#run(next);
    }
  }

  reset() {
    this.pending = null;
  }
}
