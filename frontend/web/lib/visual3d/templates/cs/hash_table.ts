// Hash table: chaining or open addressing with linear probing. hash(int) = k mod m; hash(text) =
// sum of character codes mod m (said out loud so students can check). Collisions are real.
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board } from "../../board3d/board";

type Key = number | string;
const KeyS = z.union([z.number().int().min(-9999).max(9999), z.string().min(1).max(10)]);
const Args = z.object({ keys: z.array(KeyS).max(12), size: z.number().int().min(3).max(13).default(7), strategy: z.enum(["chaining", "linear_probing"]).default("chaining") });
type A = z.infer<typeof Args>;

export const hashOf = (k: Key, m: number) => (typeof k === "number" ? ((k % m) + m) % m : [...k].reduce((s, c) => s + c.charCodeAt(0), 0) % m);
const how = (k: Key, m: number) => (typeof k === "number" ? `${k} mod ${m} = ${hashOf(k, m)}` : `(sum of letter codes of "${k}") mod ${m} = ${hashOf(k, m)}`);

/** Place keys; returns slots (probing) or chains, plus the probe path of every key. */
export function build(a: A) {
  const chains: Key[][] = Array.from({ length: a.size }, () => []), slots: (Key | null)[] = Array(a.size).fill(null);
  const paths = new Map<Key, number[]>();
  let collisions = 0;
  for (const k of a.keys) {
    const h = hashOf(k, a.size);
    if (a.strategy === "chaining") {
      if (chains[h].includes(k)) continue;
      if (chains[h].length) collisions++;
      chains[h].push(k);
      paths.set(k, [h]);
    } else {
      if (slots.includes(k)) continue;
      if (!slots.includes(null)) throw new VisualError(`The table is full (${a.size} slots): resize it before inserting ${k}.`);
      const path = [h];
      while (slots[path[path.length - 1]] !== null) path.push((path[path.length - 1] + 1) % a.size);
      if (path.length > 1) collisions++;
      slots[path[path.length - 1]] = k;
      paths.set(k, path);
    }
  }
  const stored = a.strategy === "chaining" ? chains.flat().length : slots.filter((s) => s !== null).length;
  return { chains, slots, paths, collisions, load: stored / a.size };
}

function draw(b: Board, a: A) {
  b.clear();
  const t = build(a);
  for (let i = 0; i < a.size; i++) {
    const z = (a.size / 2 - i) * 0.72;
    b.box(`b${i}`, { at: [0, 0, z], size: [0.9, 0.6, 0.6], color: "muted", label: String(i), inside: true });
    if (a.strategy === "linear_probing") {
      const k = t.slots[i];
      if (k !== null) b.box(`k${String(k)}`, { at: [1.3, 0, z], size: [1.4, 0.6, 0.6], color: "idle", label: String(k), inside: true });
    } else t.chains[i].forEach((k, j) => {
      b.box(`k${String(k)}`, { at: [1.6 + j * 1.75, 0, z], size: [1.3, 0.6, 0.6], color: "idle", label: String(k), inside: true });
      b.arrow(`c${String(k)}`, { from: [j ? 1.6 + (j - 1) * 1.75 + 0.66 : 0.46, 0, z], to: [1.6 + j * 1.75 - 0.66, 0, z], color: "accent", width: 0.02 });
    });
  }
  const longest = a.strategy === "chaining" ? Math.max(1, ...t.chains.map((c) => c.length)) : 1;
  b.fit([[-1, 0, -a.size * 0.38], [1.6 + longest * 1.75, 0, a.size * 0.42]], "front");
  b.state.hash = a;
  return t;
}

const factsOf = (a: A, t: ReturnType<typeof build>, extra = {}) => ({ size: a.size, strategy: a.strategy, keys: a.keys, collisions: t.collisions, load_factor: Math.round(t.load * 100) / 100, ...extra });

export const hashTableTemplate = defineTemplate({
  id: "hash_table", domain: "cs", family: "data_structures", title: "Hash table",
  topics: ["hash table", "hash map", "hashing", "collision", "chaining", "linear probing", "load factor"], schema: Args,
  defaults: { keys: [15, 22, 10, 31, 4, 13], size: 7, strategy: "chaining" },
  narrationHints: ["The hash picks a bucket, so lookups skip straight there.", "Two keys in one bucket is a collision."],
  run(b, a): Result { const t = draw(b, a); return { facts: factsOf(a, t), steps: [], summary: `${a.keys.length} keys in ${a.size} buckets (${a.strategy.replace("_", " ")}), ${t.collisions} collision(s).` }; },
  actions: {
    insert: { description: "Insert a key.", schema: z.object({ key: KeyS }), run(b, { key }) {
      const a = b.state.hash as A;
      if (a.keys.includes(key)) throw new VisualError(`${key} is already in the table.`);
      if (a.keys.length >= 12) throw new VisualError("Twelve keys is the most this board shows.");
      const next = { ...a, keys: [...a.keys, key] };
      const t = build(next);
      const path = t.paths.get(key)!;
      const steps: Step[] = [{ caption: `hash: ${how(key, a.size)}`, apply: async (bb, o) => { await bb.setColor(`b${path[0]}`, "active", o); } }];
      if (path.length > 1) steps.push({ caption: `Collision: probe ${path.slice(1).join(" → ")} to the first empty slot`, apply: async (bb, o) => { for (const p of path.slice(1)) await bb.setColor(`b${p}`, "warn", o); } });
      else if (a.strategy === "chaining" && t.chains[path[0]].length > 1) steps.push({ caption: `Collision: bucket ${path[0]} already has a key, so add ${key} to its chain`, apply: () => {} });
      steps.push({ caption: `Stored ${key}`, apply: async (bb, o) => { draw(bb, next); await bb.setColor(`k${String(key)}`, "done", o); } });
      return { facts: factsOf(next, t, { inserted: key, bucket: path[path.length - 1], probes: path.length }), steps, summary: `Insert ${key}: ${how(key, a.size)}.` };
    } },
    search: { description: "Look a key up.", schema: z.object({ key: KeyS }), run(b, { key }) {
      const a = b.state.hash as A, t = build(a), path = t.paths.get(key);
      const h = hashOf(key, a.size);
      return { facts: factsOf(a, t, { key, found: !!path, bucket: h }), steps: [{ caption: `hash: ${how(key, a.size)}`, apply: async (bb, o) => { await bb.setColor(`b${h}`, "active", o); } }, { caption: path ? `Found ${key}` : `${key} is not there`, apply: async (bb, o) => { if (path) await bb.setColor(`k${String(key)}`, "done", o); } }], summary: path ? `${key} is in bucket ${path[path.length - 1]}.` : `${key} is not in the table.` };
    } },
    resize: { description: "Rehash every key into a new table size.", schema: z.object({ size: z.number().int().min(3).max(13) }), run(b, { size }) {
      const a = { ...(b.state.hash as A), size }, t = draw(b, a);
      return { facts: factsOf(a, t), steps: [{ caption: `Rehash every key into ${size} buckets: load factor now ${Math.round(t.load * 100) / 100}`, apply: () => {} }], summary: `Resized to ${size} buckets; ${t.collisions} collision(s).` };
    } },
  },
});
