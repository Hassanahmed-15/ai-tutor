import { CosmosClient, type Container } from "@azure/cosmos";

/**
 * Cosmos DB data layer, replacing Postgres/Drizzle.
 *
 * WHY THE SHAPE CHANGED. Cosmos is a document store with no joins and no cross-container
 * transactions, so the relational schema does not carry over as-is. Two deliberate consequences:
 *
 *  1. The learner PROFILE is embedded in the user document rather than living in its own table.
 *     In Postgres a separate table was right — different change rates, and a session lookup should
 *     not read data it has no business touching. Here the opposite holds: a second container would
 *     mean a second round trip and a second RU charge on every profile read, with no join to make
 *     it cheap. One document, one read.
 *
 *  2. Sessions stay separate, because they have a genuinely different lifecycle: they expire, they
 *     are created and revoked constantly, and Cosmos can delete them automatically via TTL. Keeping
 *     them inside the user document would rewrite that document on every login.
 *
 * PARTITION KEYS. Users partition by `id`, sessions by `tokenHash` — in both cases the value every
 * lookup already has. A query that cannot name its partition fans out across all of them, which is
 * the single most common way a Cosmos bill and its latency both go wrong.
 */

const DATABASE_ID = "aria";
export const USERS_CONTAINER = "users";
export const SESSIONS_CONTAINER = "sessions";

export type UserDoc = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  onboardedAt: string | null;
  /** Embedded rather than a separate container — see the note above. */
  profile: {
    displayName: string | null;
    age: number | null;
    vision: string | null;
    adhd: boolean | null;
    dyslexia: boolean | null;
    hearing: boolean | null;
    reducedMotion: boolean | null;
    captions: boolean | null;
    slowerPace: boolean | null;
    simplerLanguage: boolean | null;
    notes: string | null;
    updatedAt: string;
  } | null;
};

export type SessionDoc = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  /** Cosmos deletes the document this many seconds after its last write. */
  ttl: number;
};

const globalForCosmos = globalThis as unknown as { ariaCosmos?: CosmosClient };

function client(): CosmosClient {
  const conn = process.env.COSMOS_CONNECTION_STRING;
  if (!conn) throw new Error("COSMOS_CONNECTION_STRING is not set.");
  // Cached across hot reloads: a new client per reload leaks sockets in dev and wastes
  // connections in production, where replicas share a modest budget.
  if (!globalForCosmos.ariaCosmos) globalForCosmos.ariaCosmos = new CosmosClient(conn);
  return globalForCosmos.ariaCosmos;
}

export function databaseConfigured(): boolean {
  return Boolean(process.env.COSMOS_CONNECTION_STRING);
}

export function users(): Container {
  return client().database(DATABASE_ID).container(USERS_CONTAINER);
}

export function sessionsContainer(): Container {
  return client().database(DATABASE_ID).container(SESSIONS_CONTAINER);
}

/**
 * Create the database and containers if they do not exist.
 *
 * Called on first use rather than as a migration step, because Cosmos has no schema to migrate —
 * containers and their partition keys are the only structure, and creating them is idempotent.
 * Throughput is left unset so the containers inherit the account's shared free-tier RU/s.
 */
let ensured = false;
export async function ensureContainers(): Promise<void> {
  if (ensured) return;
  const { database } = await client().databases.createIfNotExists({ id: DATABASE_ID });
  await database.containers.createIfNotExists({
    id: USERS_CONTAINER,
    partitionKey: { paths: ["/id"] },
    // Email must be unique, and Cosmos enforces uniqueness only within a partition — so this
    // constraint alone is not sufficient. See findUserByEmail for how signup actually guards it.
    uniqueKeyPolicy: { uniqueKeys: [{ paths: ["/email"] }] },
  });
  await database.containers.createIfNotExists({
    id: SESSIONS_CONTAINER,
    partitionKey: { paths: ["/tokenHash"] },
    // TTL enabled so expired sessions delete themselves instead of accumulating forever.
    defaultTtl: -1,
  });
  ensured = true;
}
