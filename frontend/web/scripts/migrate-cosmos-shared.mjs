/**
 * COPY THE COSMOS DATA ONTO THE SHARED, FREE-TIER DATABASE (2026-10-11).
 *
 * The old database `aria` gave each of its containers 400 RU/s of its own — 4,400 RU/s billed
 * around the clock. This creates `aria-shared` with 1,000 RU/s shared by all containers (the
 * account's free-tier allowance), recreates every container of `aria` there with the same partition
 * key, unique keys, indexing policy and default TTL but no throughput of its own, and copies every
 * item across (upsert, so it can be run again safely). lib/db/cosmos.ts uses `aria-shared` by default.
 *
 *   node scripts/migrate-cosmos-shared.mjs [--dry-run] [--from aria] [--to aria-shared]
 *
 * Reads COSMOS_CONNECTION_STRING from the environment or frontend/web/.env.local. Prints each
 * container's item count on both sides and exits 1 when any differs. --dry-run only counts.
 */
import { CosmosClient } from "@azure/cosmos";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const dryRun = args.includes("--dry-run");
const FROM = flag("--from", "aria");
const TO = flag("--to", "aria-shared");
const SHARED_THROUGHPUT = 1000;

function connectionString() {
  if (process.env.COSMOS_CONNECTION_STRING) return process.env.COSMOS_CONNECTION_STRING.trim();
  const env = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("COSMOS_CONNECTION_STRING="));
  if (!line) throw new Error("COSMOS_CONNECTION_STRING is not set");
  return line.slice("COSMOS_CONNECTION_STRING=".length).trim().replace(/^"|"$/g, "");
}

const client = new CosmosClient(connectionString());
const source = client.database(FROM);
const { resources: containers } = await source.containers.readAll().fetchAll();
console.log(`${FROM}: ${containers.length} containers — ${containers.map((c) => c.id).join(", ")}`);

async function count(container) {
  const { resources } = await container.items.query("SELECT VALUE COUNT(1) FROM c").fetchAll();
  return resources[0] ?? 0;
}

if (dryRun) {
  for (const def of containers) console.log(`  ${def.id}: ${await count(source.container(def.id))} items`);
  process.exit(0);
}

const { database: target } = await client.databases.createIfNotExists({ id: TO, throughput: SHARED_THROUGHPUT });
const { resource: offer } = await target.readOffer();
console.log(`${TO}: shared throughput ${offer?.content?.offerThroughput ?? "?"} RU/s`);

let mismatches = 0;
for (const def of containers) {
  // Same shape, no throughput of its own: it draws on the database's shared pool.
  const spec = {
    id: def.id,
    partitionKey: def.partitionKey,
    ...(def.uniqueKeyPolicy?.uniqueKeys?.length ? { uniqueKeyPolicy: def.uniqueKeyPolicy } : {}),
    ...(def.indexingPolicy ? { indexingPolicy: { ...def.indexingPolicy } } : {}),
    ...(typeof def.defaultTtl === "number" ? { defaultTtl: def.defaultTtl } : {}),
  };
  const { container: to } = await target.containers.createIfNotExists(spec);
  const from = source.container(def.id);
  let copied = 0;
  const iterator = from.items.query("SELECT * FROM c", { maxItemCount: 100 });
  while (iterator.hasMoreResults()) {
    const { resources } = await iterator.fetchNext();
    for (const item of resources ?? []) {
      // System properties are the source container's; the target writes its own.
      const { _rid, _self, _etag, _attachments, _ts, ...doc } = item;
      void _rid; void _self; void _etag; void _attachments; void _ts;
      await to.items.upsert(doc);
      copied++;
    }
  }
  const [a, b] = [await count(from), await count(to)];
  if (a !== b) mismatches++;
  console.log(`  ${def.id}: copied ${copied}; ${FROM} ${a} / ${TO} ${b}${a === b ? "" : "  <-- MISMATCH"}`);
}

if (mismatches) {
  console.error(`FAILED: ${mismatches} container(s) differ`);
  process.exit(1);
}
console.log("OK — every container matches.");
