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
export const LEADERBOARD_CONTAINER = "leaderboard";

/**
 * One board, so `board` is a constant rather than a real dimension.
 *
 * That is deliberate: it makes every read name its partition. A leaderboard query that cannot name
 * one fans out across all of them, which is the single most common way a Cosmos bill and its latency
 * both go wrong — and a leaderboard is read on every visit to the prompt page.
 */
export const ADHD_BOARD = "adhd";

/**
 * The one accessibility profile a learner is currently using.
 *
 * SINGLE VALUE, NOT A SET OF FLAGS. Each of these drives a genuinely different lesson: the blind
 * profile narrates every drawing and is keyboard-driven, ADHD watches attention and pauses,
 * dyslexia rewrites dense text into short spoken lines. Those are not layers that compose — a
 * lecture cannot be simultaneously audio-only and caption-first — so the model has to hold one at
 * a time, and letting someone tick several would promise a combination the player cannot deliver.
 *
 * It is switchable from settings precisely because it is one choice: someone with low vision AND
 * ADHD picks whichever matters more today, and changes it whenever that shifts.
 */
export type AccessibilityProfile =
  | "none"
  | "blind"
  | "low-vision"
  | "adhd"
  | "dyslexia"
  | "deaf";

export const ACCESSIBILITY_PROFILES: AccessibilityProfile[] = [
  "none",
  "blind",
  "low-vision",
  "adhd",
  "dyslexia",
  "deaf",
];

export type UserDoc = {
  id: string;
  email: string;
  /** Unique, lowercase. The public name; `displayName` is what Aria says out loud. */
  username: string;
  passwordHash: string;
  createdAt: string;
  onboardedAt: string | null;
  /** Embedded rather than a separate container — see the note above. */
  profile: {
    displayName: string | null;
    age: number | null;
    /**
     * The chosen profile. Null means onboarding has not run yet, which is NOT the same as "none":
     * "none" is someone who actively said they need no accommodation.
     */
    accessibility: AccessibilityProfile | null;
    /**
     * Independent preferences, kept as separate flags on purpose — unlike the profile above, these
     * genuinely do compose. Someone using the ADHD profile may also want captions and a slower
     * pace, and none of the three contradict each other.
     */
    reducedMotion: boolean | null;
    captions: boolean | null;
    slowerPace: boolean | null;
    simplerLanguage: boolean | null;
    notes: string | null;
    updatedAt: string;
  } | null;
};

/**
 * One row per ADHD learner. `id` is the user id, so a session-end write is an upsert rather than a
 * read-modify-write, and a learner can never end up with two rows.
 *
 * Only ADHD learners are ever written here — the API enforces that server-side, because a check that
 * only exists in the client is not a check.
 */
export type LeaderboardDoc = {
  id: string;
  /** Always ADHD_BOARD. The partition key. */
  board: string;
  username: string;
  displayName: string | null;
  /** Accumulated across sessions. */
  xp: number;
  sessions: number;
  updatedAt: string;
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

export function leaderboard(): Container {
  return client().database(DATABASE_ID).container(LEADERBOARD_CONTAINER);
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
  await database.containers.createIfNotExists({
    id: LEADERBOARD_CONTAINER,
    // Partitioned by the board name, so reading the board is a single-partition query. See ADHD_BOARD.
    partitionKey: { paths: ["/board"] },
  });
  ensured = true;
}

/**
 * Bring a document written before usernames and the single-profile model up to the current shape.
 *
 * Applied on read rather than as a bulk migration script: Cosmos has no schema to alter, accounts
 * are few, and a lazy upgrade cannot half-finish the way a batch job interrupted midway can.
 *
 * Two things need repairing, both of which otherwise surface as a confusing failure much later:
 *
 *  1. NO USERNAME. Derived from the email's local part, then scrubbed to the allowed alphabet —
 *     `a.b+c@x.com` would otherwise yield "a.b+c", which fails validation, so the first settings
 *     save a legacy user attempted would be rejected over a field they never filled in.
 *
 *  2. THE OLD PROFILE SHAPE (`vision`/`adhd`/`dyslexia`/`hearing`). Collapsed into the single
 *     `accessibility` value, preferring the more specific accommodation when several were ticked,
 *     because that is the one whose absence breaks the lesson hardest. The dead keys are dropped
 *     rather than left in place — carrying two sources of truth for the same question is how the
 *     wrong one eventually gets read.
 */
type LegacyProfile = {
  vision?: string | null;
  adhd?: boolean | null;
  dyslexia?: boolean | null;
  hearing?: boolean | null;
};

export function migrateUserDoc(raw: UserDoc): { doc: UserDoc; changed: boolean } {
  let changed = false;
  const doc = { ...raw };

  if (!doc.username) {
    const base = doc.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "");
    // Pad a too-short result so it satisfies the 3-character minimum.
    doc.username = (base.length >= 3 ? base : `user-${base}`).slice(0, 24);
    changed = true;
  }

  const legacy = doc.profile as (typeof doc.profile & LegacyProfile) | null;
  if (legacy && ("vision" in legacy || "adhd" in legacy || "dyslexia" in legacy || "hearing" in legacy)) {
    const { vision, adhd, dyslexia, hearing, ...rest } = legacy;
    doc.profile = {
      ...rest,
      accessibility:
        rest.accessibility ??
        (vision === "blind"
          ? "blind"
          : vision === "low-vision"
            ? "low-vision"
            : hearing === true
              ? "deaf"
              : dyslexia === true
                ? "dyslexia"
                : adhd === true
                  ? "adhd"
                  : vision === "normal"
                    ? "none"
                    : null),
    };
    changed = true;
  }

  return { doc, changed };
}
