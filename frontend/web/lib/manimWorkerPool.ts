import "server-only";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cpus } from "node:os";
import path from "node:path";

/**
 * A pool of long-lived Manim render processes.
 *
 * WHY NOT execFile PER BEAT. `import manim` costs ~3.3s and a low-quality beat renders in
 * ~8.7s cold, so almost 40% of every render was re-importing a library already in memory.
 * Keeping workers warm takes a beat from ~8.7s to ~3.3s, and running several in parallel
 * turns a 12-beat lecture from ~104s of serial rendering into ~10-15s.
 *
 * That difference is the whole fix for "the narration finished before the video appeared":
 * combined with prefetching the lecture up front, later beats are rendered long before the
 * student reaches them.
 *
 * Workers are spawned lazily on first use and respawned if they die, so a crash costs one
 * beat rather than the feature.
 */

const SCRIPT_DIR = path.join(process.cwd(), "scripts", "manim");
const WORKER_SCRIPT = path.join(SCRIPT_DIR, "render_worker.py");
const PYTHON =
  process.env.MANIM_PYTHON_BINARY ?? path.join(SCRIPT_DIR, ".venv", "Scripts", "python.exe");

/** Leave a core for Node and the OS; Manim is CPU-bound and oversubscribing only adds latency. */
const POOL_SIZE = Math.max(
  1,
  Math.min(Number(process.env.MANIM_POOL_SIZE ?? 0) || Math.max(1, cpus().length - 1), 6),
);
const READY_TIMEOUT_MS = 60_000;
const JOB_TIMEOUT_MS = Number(process.env.MANIM_RENDER_TIMEOUT_MS ?? 180_000);

export type WorkerJob = {
  script: unknown;
  output: string;
  quality: "low" | "medium" | "high";
};

type Pending = {
  id: string;
  job: WorkerJob;
  resolve: (durationMs: number) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout | null;
};

class Worker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private ready = false;
  private readyWaiters: Array<(ok: boolean) => void> = [];
  current: Pending | null = null;

  get busy(): boolean {
    return this.current !== null;
  }

  get alive(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  start(): void {
    if (this.proc) return;
    const proc = spawn(PYTHON, [WORKER_SCRIPT], {
      cwd: SCRIPT_DIR,
      // Manim stages frames in the system temp dir, which on this machine is a nearly-full
      // C:. Keep scratch beside the script where the render output already has to fit.
      env: {
        ...process.env,
        TMPDIR: SCRIPT_DIR,
        TEMP: SCRIPT_DIR,
        TMP: SCRIPT_DIR,
        // Node writes UTF-8 on this pipe; Python on Windows would otherwise decode it with
        // the locale encoding and mangle every subscript ("H₂O" -> "Hâ‚‚O"). The worker also
        // reconfigures its own streams — this covers a worker started by any other means.
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });
    this.proc = proc;

    proc.stdout.setEncoding("utf-8");
    proc.stdout.on("data", (chunk: string) => this.onData(chunk));
    // Worker diagnostics (including Python tracebacks) come out on stderr by design.
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[manim-worker] ${text.slice(0, 500)}`);
    });
    proc.on("exit", (code) => this.onExit(code));
    proc.on("error", (err) => {
      console.error(`[manim-worker] spawn failed: ${err.message}`);
      this.onExit(-1);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.onLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    let msg: { ready?: boolean; id?: string; ok?: boolean; durationMs?: number; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`[manim-worker] unparseable line: ${line.slice(0, 200)}`);
      return;
    }

    if (msg.ready) {
      this.ready = true;
      this.readyWaiters.splice(0).forEach((w) => w(true));
      return;
    }

    const pending = this.current;
    if (!pending || msg.id !== pending.id) return;
    this.finish(pending, msg.ok ? null : new Error(msg.error ?? "render failed"), msg.durationMs ?? 0);
  }

  private finish(pending: Pending, error: Error | null, durationMs: number): void {
    if (pending.timer) clearTimeout(pending.timer);
    this.current = null;
    if (error) pending.reject(error);
    else pending.resolve(durationMs);
  }

  private onExit(code: number | null): void {
    this.proc = null;
    this.ready = false;
    this.readyWaiters.splice(0).forEach((w) => w(false));
    if (this.current) {
      this.finish(this.current, new Error(`manim worker exited (code ${code})`), 0);
    }
  }

  async waitReady(): Promise<boolean> {
    if (this.ready) return true;
    this.start();
    if (this.ready) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
      this.readyWaiters.push((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  }

  run(id: string, job: WorkerJob): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (!this.proc) return reject(new Error("worker not running"));
      const pending: Pending = { id, job, resolve, reject, timer: null };
      pending.timer = setTimeout(() => {
        // A wedged render must not hold a pool slot forever. Killing the process triggers
        // onExit, which rejects this job and lets the pool respawn a clean worker.
        console.error(`[manim-worker] job ${id} timed out; restarting worker`);
        this.proc?.kill();
      }, JOB_TIMEOUT_MS);
      this.current = pending;
      this.proc.stdin.write(`${JSON.stringify({ id, ...job })}\n`);
    });
  }

  stop(): void {
    this.proc?.stdin.write("exit\n");
    this.proc?.kill();
  }
}

type QueueEntry = {
  id: string;
  job: WorkerJob;
  resolve: (durationMs: number) => void;
  reject: (error: Error) => void;
};

class Pool {
  private workers: Worker[] = [];
  private queue: QueueEntry[] = [];
  private counter = 0;

  private ensureWorkers(): void {
    while (this.workers.length < POOL_SIZE) this.workers.push(new Worker());
    for (const worker of this.workers) if (!worker.alive) worker.start();
  }

  submit(job: WorkerJob): Promise<number> {
    this.ensureWorkers();
    return new Promise<number>((resolve, reject) => {
      this.queue.push({ id: `j${++this.counter}`, job, resolve, reject });
      void this.pump();
    });
  }

  private pumping = false;

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const worker = this.workers.find((w) => !w.busy);
        if (!worker) break; // every worker busy; whoever finishes will pump again

        const ok = await worker.waitReady();
        if (!ok) {
          const entry = this.queue.shift();
          entry?.reject(new Error("manim worker failed to start"));
          continue;
        }

        const entry = this.queue.shift();
        if (!entry) break;

        worker
          .run(entry.id, entry.job)
          .then(entry.resolve, entry.reject)
          .finally(() => {
            void this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }

  get size(): number {
    return POOL_SIZE;
  }
}

// One pool per server process. Module scope is the right lifetime: workers should outlive
// individual requests, which is the entire reason they are warm.
let pool: Pool | null = null;

export function manimPool(): Pool {
  if (!pool) pool = new Pool();
  return pool;
}

export const MANIM_POOL_SIZE = POOL_SIZE;
