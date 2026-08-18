import { pgTable, text, integer, timestamp, boolean, uuid, index } from "drizzle-orm/pg-core";

/**
 * Users and their learning profile.
 *
 * Two tables rather than one, because they answer different questions and change at different
 * rates: `users` is credentials and identity, `profiles` is how the product should behave for this
 * person. Keeping the accessibility answers out of the auth row also means a session lookup does
 * not drag along data it has no business reading.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    /**
     * Argon2id hash. Never the password itself, and never a reversible encryption — a database
     * leak must not hand over anyone's credentials, and argon2id is memory-hard so a stolen hash
     * is expensive to attack offline.
     */
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set once onboarding is finished, so the app knows whether to route a new user through it. */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
  }),
);

/**
 * The learning profile.
 *
 * Every accessibility field is nullable and defaults to "not stated" rather than to a negative.
 * A student who skipped the question has NOT told us they can see well — treating silence as "no
 * needs" is exactly how accessibility features end up never reaching the people they are for.
 */
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  age: integer("age"),

  /** "blind" | "low-vision" | "normal" | null when unanswered. */
  vision: text("vision"),
  adhd: boolean("adhd"),
  dyslexia: boolean("dyslexia"),
  /** Deaf or hard of hearing. */
  hearing: boolean("hearing"),

  /**
   * Additional supports worth asking about, because each one changes what the lecture should do
   * rather than merely how it looks:
   *  - reducedMotion  → the board should not animate; drawings appear rather than draw themselves
   *  - captions       → narration is always captioned, not only in a "deaf mode"
   *  - slowerPace     → longer pauses at checkpoints and between beats
   *  - simplerLanguage→ shorter sentences and fewer clauses in the script
   */
  reducedMotion: boolean("reduced_motion"),
  captions: boolean("captions"),
  slowerPace: boolean("slower_pace"),
  simplerLanguage: boolean("simpler_language"),

  /** Free text: anything the fixed questions did not cover. */
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Refresh-token sessions.
 *
 * Stored server-side so a session can actually be REVOKED. A stateless refresh token cannot be
 * invalidated before it expires, which means "log out everywhere" and "this device was stolen"
 * are both impossible to honour. Only the hash is kept, for the same reason passwords are hashed.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when rotated or revoked; a used refresh token must never work twice. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    userIdx: index("sessions_user_idx").on(table.userId),
    tokenIdx: index("sessions_token_idx").on(table.tokenHash),
  }),
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
