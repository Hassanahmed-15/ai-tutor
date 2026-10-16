/**
 * Live check (no extra model spend): hit health + curricula on an already-running Next app, or
 * boot one if needed, and confirm a bench PNG exists.
 *   npx tsx --tsconfig tsconfig.json scripts/bench/live.mts
 */
import { spawn } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const PORT = Number(process.env.LIVE_PORT ?? "3017");
const CANDIDATES = [
  ...new Set([
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    "http://127.0.0.1:3000",
    "http://localhost:3000",
  ]),
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string) {
  const res = await fetch(url, { headers: { "cache-control": "no-store" } });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

async function probe(bases: string[]) {
  let health: Awaited<ReturnType<typeof get>> | undefined;
  let curricula: Awaited<ReturnType<typeof get>> | undefined;
  let base: string | undefined;
  let lastError: string | undefined;
  for (const candidate of bases) {
    try {
      health = await get(`${candidate}/api/health`);
      if (health.status !== 200) continue;
      curricula = await get(`${candidate}/api/curricula`);
      base = candidate;
      break;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return { health, curricula, base, lastError };
}

const pngDir = path.join(WEB, ".bench", "phase0-tuning", "png");
const pngs = existsSync(pngDir) ? readdirSync(pngDir).filter((f) => f.endsWith(".png")) : [];
const probes: Record<string, unknown> = { pngCount: pngs.length };

let { health, curricula, base, lastError } = await probe(CANDIDATES);
probes.reused = Boolean(base);
if (lastError) probes.lastError = lastError;

let child: ReturnType<typeof spawn> | undefined;
const log: string[] = [];
if (!base) {
  child = spawn("npx", ["next", "dev", "--webpack", "-H", "127.0.0.1", "-p", String(PORT)], {
    cwd: WEB,
    env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (buf) => { log.push(String(buf)); });
  child.stderr?.on("data", (buf) => { log.push(String(buf)); });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const extra: string[] = [...CANDIDATES];
    const running = log.join("").match(/Local:\s+(http:\/\/\S+)/);
    if (running) extra.unshift(running[1].replace(/\/$/, ""));
    const found = await probe(extra);
    health = found.health;
    curricula = found.curricula;
    base = found.base;
    if (found.lastError) probes.lastError = found.lastError;
    if (health?.status === 200) break;
    await wait(1500);
  }
  probes.logTail = log.join("").slice(-800);
}

if (child) {
  child.kill("SIGTERM");
  await wait(500);
  child.kill("SIGKILL");
}

probes.base = base ?? null;
probes.health = health ? { status: health.status, json: health.json } : null;
probes.curricula = curricula ? { status: curricula.status, builtAt: (curricula.json as { builtAt?: string } | null)?.builtAt ?? null } : null;

const ok = health?.status === 200 && (health.json as { status?: string } | null)?.status === "ok"
  && curricula?.status === 200
  && pngs.length > 0;
await mkdir(path.join(WEB, ".bench"), { recursive: true });
await writeFile(path.join(WEB, ".bench", "live.json"), JSON.stringify({ ok, probes: { ...probes, samplePng: pngs[0] ?? null } }, null, 2));
console.log(JSON.stringify({ ok, health: health?.status, curricula: curricula?.status, pngs: pngs.length, samplePng: pngs[0] ?? null, base: base ?? null, reused: probes.reused }, null, 2));
process.exit(ok ? 0 : 1);
