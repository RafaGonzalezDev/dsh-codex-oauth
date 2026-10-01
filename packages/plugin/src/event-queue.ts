/** A bounded-by-protocol notice queue, owned by one cancellable RPC invocation. */
export class EventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private ended = false;
  private wake: (() => void) | undefined;
  push(value: T): void { if (!this.ended) { this.values.push(value); this.wake?.(); } }
  end(): void { this.ended = true; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (!this.ended || this.values.length) {
      const next = this.values.shift();
      if (next !== undefined) { yield next; continue; }
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
  }
}
