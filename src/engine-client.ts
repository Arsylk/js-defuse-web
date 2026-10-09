// One worker, one job at a time. Stopping a job terminates the worker (the
// engine cannot be interrupted mid-pass) and starts a fresh one.
import type { Entry } from 'js-defuser/logger';
import type { DoneMessage, JobMessage, PipelineStage, WorkerMessage } from './protocol';

export interface Catalog {
  pipeline: PipelineStage[];
  defaults: string[];
}

type Pending = {
  onLog: (entry: Entry) => void;
  resolve: (done: DoneMessage) => void;
  reject: (error: Error) => void;
};

export class EngineClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private catalogResolvers: Array<(c: Catalog) => void> = [];
  private catalog: Catalog | null = null;
  readonly ready: Promise<void>;
  private markReady!: () => void;

  constructor() {
    this.ready = new Promise<void>((resolve) => (this.markReady = resolve));
    this.spawn();
  }

  private spawn(): void {
    this.worker?.terminate();
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      switch (m.type) {
        case 'catalog':
          this.catalog = { pipeline: m.pipeline, defaults: m.defaults };
          for (const r of this.catalogResolvers) r(this.catalog);
          this.catalogResolvers = [];
          break;
        case 'ready':
          this.markReady();
          break;
        case 'log':
          this.pending?.onLog(m.entry);
          break;
        case 'done': {
          const p = this.pending;
          this.pending = null;
          p?.resolve(m);
          break;
        }
        case 'error': {
          const p = this.pending;
          this.pending = null;
          p?.reject(new Error(m.message));
          break;
        }
      }
    };
    worker.onerror = (ev) => {
      const p = this.pending;
      this.pending = null;
      p?.reject(new Error(ev.message || 'worker crashed'));
    };
    this.worker = worker;
  }

  getCatalog(): Promise<Catalog> {
    if (this.catalog) return Promise.resolve(this.catalog);
    return new Promise((resolve) => this.catalogResolvers.push(resolve));
  }

  run(job: Omit<JobMessage, 'type'>, onLog: (entry: Entry) => void): Promise<DoneMessage> {
    if (this.pending) throw new Error('a run is already in progress');
    return new Promise((resolve, reject) => {
      this.pending = { onLog, resolve, reject };
      this.worker!.postMessage({ type: 'run', ...job } satisfies JobMessage);
    });
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  /** Abandon the running job; the next run starts on a fresh worker. */
  stop(): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(new Error('stopped'));
    this.spawn();
  }
}
