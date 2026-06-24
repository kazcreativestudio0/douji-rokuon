export class LatestOnlyQueue<T> {
  private active = false;
  private pending: T | null = null;

  constructor(private readonly worker: (item: T) => Promise<void>) {}

  enqueue(item: T) {
    this.pending = item;
    if (!this.active) {
      void this.drain();
    }
  }

  clear() {
    this.pending = null;
  }

  private async drain() {
    this.active = true;
    try {
      while (this.pending !== null) {
        const nextItem = this.pending;
        this.pending = null;
        try {
          await this.worker(nextItem);
        } catch (error) {
          console.error('LatestOnlyQueue worker failed:', error);
        }
      }
    } finally {
      this.active = false;
    }
  }
}

export class SequentialQueue<T> {
  private active = false;
  private pending: T[] = [];
  private idleResolvers: Array<() => void> = [];

  constructor(private readonly worker: (item: T) => Promise<void>) {}

  enqueue(item: T) {
    this.pending.push(item);
    if (!this.active) {
      void this.drain();
    }
  }

  get size() {
    return this.pending.length + (this.active ? 1 : 0);
  }

  async whenIdle() {
    if (!this.active && this.pending.length === 0) return;
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  clear() {
    this.pending = [];
    if (!this.active) this.resolveIdle();
  }

  private resolveIdle() {
    const resolvers = this.idleResolvers.splice(0);
    resolvers.forEach((resolve) => resolve());
  }

  private async drain() {
    this.active = true;
    try {
      while (this.pending.length > 0) {
        const nextItem = this.pending.shift()!;
        try {
          await this.worker(nextItem);
        } catch (error) {
          console.error('SequentialQueue worker failed:', error);
        }
      }
    } finally {
      this.active = false;
      this.resolveIdle();
    }
  }
}
