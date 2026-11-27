// Finding what to show must not hold up a drag. When it took longer than this, the drag goes on alone and it is shown at
// its end.
const slowestWhileDraggingMilliseconds = 40;
// A moment later the same question can be quick, because the layer has prepared what it needs.
const measurementsKept = 3;

export class DragBudget {
  #durations = [];

  get #isSlow() {
    const isMeasured = this.#durations.length >= measurementsKept;
    return isMeasured && Math.min(...this.#durations) > slowestWhileDraggingMilliseconds;
  }

  // What find() gives, or otherwise while a drag would have to wait for it.
  of(find, isDragging, otherwise) {
    if (isDragging && this.#isSlow) return otherwise;
    const start = performance.now();
    const found = find();
    this.#durations = [...this.#durations, performance.now() - start].slice(-measurementsKept);
    return found;
  }

  // Another object can be quicker.
  forget() {
    this.#durations = [];
  }
}
