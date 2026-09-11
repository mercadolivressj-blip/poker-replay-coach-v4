/**
 * Single-flight async lane with latest-wins backpressure. If OCR is already
 * running, old intermediate frames are discarded and only the newest job is
 * retained. That prevents a fast cash replay from building an OCR backlog.
 */
export class LatestLane {
  constructor(name = 'lane') {
    this.name = name;
    this.busy = false;
    this.pending = null;
    this.runs = 0;
    this.dropped = 0;
    this.lastMs = null;
  }

  schedule(job) {
    if (this.busy) {
      if (this.pending) this.dropped++;
      this.pending = job;
      return;
    }
    void this.#run(job);
  }

  async #run(job) {
    this.busy = true;
    this.runs++;
    const t0 = performance.now();
    try {
      await job();
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
