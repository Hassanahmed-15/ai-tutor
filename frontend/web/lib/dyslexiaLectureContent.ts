/**
 * Dyslexia-track companion content. Built to the supplied spec exactly: every beat's dense
 * teacher sentence is rewritten into short, standalone lines, each paired with a simple
 * icon, and the rewrite is calibrated to the student's measured reading level — the same
 * idea expressed with fewer/simpler words at lower levels. Delivery is audio-led; the text
 * is minimal and rendered in a dyslexia-friendly font by the player.
 *
 * Purely additive — keyed by the same beat `id`s in lessonContent.ts, read only by
 * DyslexiaLessonPlayer.
 */

/** A single short line of the rewrite, paired with an icon, narrated one at a time. */
export interface DyslexiaChunk {
  /** The short, standalone line of text (kept deliberately brief). */
  text: string;
  /** A simple emoji icon that stands in for the meaning (sun, leaf, water drop, etc.). */
  icon: string;
}

/** Reading levels the "read level" dial calibrates to. Lower = fewer, simpler words. */
export type ReadingLevel = "simplest" | "simple" | "standard";
export const READING_LEVELS: ReadingLevel[] = ["simplest", "simple", "standard"];
export const READING_LEVEL_LABELS: Record<ReadingLevel, string> = {
  simplest: "Level 1 · fewest words",
  simple: "Level 2 · short lines",
  standard: "Level 3 · full sentences",
};

export interface DyslexiaBeatContent {
  /** The teacher's original dense sentence (animation beat 1 shows this before the split). */
  dense: string;
  /** The short-chunk rewrites per reading level. The dial picks which set is shown. */
  chunks: Record<ReadingLevel, DyslexiaChunk[]>;
}

export const dyslexiaBeatContent: Record<string, DyslexiaBeatContent> = {
  hook: {
    dense:
      "A plant never hunts for food or eats a meal the way an animal does, yet it still finds the energy to grow leaves and fruit.",
    chunks: {
      simplest: [
        { text: "A plant never eats.", icon: "🌱" },
        { text: "But it still grows.", icon: "📈" },
        { text: "Where is the energy from?", icon: "❓" },
      ],
      simple: [
        { text: "A plant never eats food.", icon: "🌱" },
        { text: "But a plant still grows.", icon: "📈" },
        { text: "So where does its energy come from?", icon: "❓" },
      ],
      standard: [
        { text: "A plant does not eat food like an animal.", icon: "🌱" },
        { text: "But it still grows leaves and fruit.", icon: "📈" },
        { text: "Where does it get the energy?", icon: "❓" },
      ],
    },
  },
  "define-photosynthesis": {
    dense:
      "Photosynthesis is the process by which green plants use sunlight to synthesize nutrients from carbon dioxide and water.",
    chunks: {
      simplest: [
        { text: "Photosynthesis means making food.", icon: "🍽️" },
        { text: "Plants use sunlight.", icon: "☀️" },
        { text: "Plants take in water and air.", icon: "💧" },
        { text: "They make food and oxygen.", icon: "🫧" },
      ],
      simple: [
        { text: "Photosynthesis means: plants make food.", icon: "🍽️" },
        { text: "Plants use sunlight.", icon: "☀️" },
        { text: "Plants take in water and carbon dioxide.", icon: "💧" },
        { text: "They make food and release oxygen.", icon: "🫧" },
      ],
      standard: [
        { text: "Photosynthesis is how plants make their own food.", icon: "🍽️" },
        { text: "They use the energy in sunlight.", icon: "☀️" },
        { text: "They take in water and carbon dioxide.", icon: "💧" },
        { text: "They make sugar and release oxygen.", icon: "🫧" },
      ],
    },
  },
  "ingredients-fast": {
    dense:
      "Photosynthesis requires three raw inputs delivered simultaneously: solar energy, water drawn up through the roots, and atmospheric carbon dioxide.",
    chunks: {
      simplest: [
        { text: "A plant needs three things.", icon: "🔢" },
        { text: "Sunlight.", icon: "☀️" },
        { text: "Water.", icon: "💧" },
        { text: "Air (carbon dioxide).", icon: "🌬️" },
      ],
      simple: [
        { text: "A plant needs three things.", icon: "🔢" },
        { text: "One: sunlight.", icon: "☀️" },
        { text: "Two: water from the ground.", icon: "💧" },
        { text: "Three: carbon dioxide from the air.", icon: "🌬️" },
      ],
      standard: [
        { text: "Photosynthesis needs three inputs.", icon: "🔢" },
        { text: "Sunlight gives the energy.", icon: "☀️" },
        { text: "Water comes up from the roots.", icon: "💧" },
        { text: "Carbon dioxide comes from the air.", icon: "🌬️" },
      ],
    },
  },
  chloroplast: {
    dense:
      "The reactions of photosynthesis occur inside specialized structures called chloroplasts, which contain the green pigment chlorophyll.",
    chunks: {
      simplest: [
        { text: "Food is made inside the leaf.", icon: "🍃" },
        { text: "In tiny parts called chloroplasts.", icon: "🔬" },
        { text: "They are green.", icon: "🟢" },
      ],
      simple: [
        { text: "Food is made inside the leaf.", icon: "🍃" },
        { text: "In tiny parts called chloroplasts.", icon: "🔬" },
        { text: "Their green color is chlorophyll.", icon: "🟢" },
      ],
      standard: [
        { text: "Photosynthesis happens inside leaf cells.", icon: "🍃" },
        { text: "In small parts called chloroplasts.", icon: "🔬" },
        { text: "They hold the green pigment, chlorophyll.", icon: "🟢" },
      ],
    },
  },
  mechanism: {
    dense:
      "Light energy splits water molecules apart, and the resulting fragments recombine with carbon dioxide to build glucose, a sugar.",
    chunks: {
      simplest: [
        { text: "Light splits water.", icon: "⚡" },
        { text: "The pieces join with air.", icon: "🔗" },
        { text: "This makes sugar.", icon: "🍬" },
      ],
      simple: [
        { text: "Light energy splits water apart.", icon: "⚡" },
        { text: "The pieces join with carbon dioxide.", icon: "🔗" },
        { text: "Together they make sugar.", icon: "🍬" },
      ],
      standard: [
        { text: "Light energy splits water molecules.", icon: "⚡" },
        { text: "The pieces combine with carbon dioxide.", icon: "🔗" },
        { text: "This builds glucose, a sugar.", icon: "🍬" },
      ],
    },
  },
  outputs: {
    dense:
      "The process yields two products: glucose, which the plant retains as food, and oxygen, which is released into the atmosphere.",
    chunks: {
      simplest: [
        { text: "The plant makes two things.", icon: "✌️" },
        { text: "Sugar — the plant keeps it.", icon: "🍬" },
        { text: "Oxygen — it goes in the air.", icon: "🫧" },
      ],
      simple: [
        { text: "Making food creates two things.", icon: "✌️" },
        { text: "Sugar, which the plant keeps.", icon: "🍬" },
        { text: "Oxygen, which goes into the air.", icon: "🫧" },
      ],
      standard: [
        { text: "Photosynthesis makes two products.", icon: "✌️" },
        { text: "Glucose — the plant stores it as food.", icon: "🍬" },
        { text: "Oxygen — it is released into the air.", icon: "🫧" },
      ],
    },
  },
  "compare-respiration": {
    dense:
      "Cellular respiration is essentially the reverse process: organisms consume sugar and oxygen to release energy, producing carbon dioxide as a byproduct.",
    chunks: {
      simplest: [
        { text: "Your body does the opposite.", icon: "🔄" },
        { text: "You use sugar and oxygen.", icon: "🍬" },
        { text: "You make energy and air.", icon: "⚡" },
      ],
      simple: [
        { text: "Your body does the reverse.", icon: "🔄" },
        { text: "You take in sugar and oxygen.", icon: "🍬" },
        { text: "You make energy and carbon dioxide.", icon: "⚡" },
      ],
      standard: [
        { text: "Your body runs the opposite process.", icon: "🔄" },
        { text: "It uses sugar and oxygen.", icon: "🍬" },
        { text: "It releases energy and carbon dioxide.", icon: "⚡" },
      ],
    },
  },
  "why-it-matters": {
    dense:
      "Almost every food chain on Earth originates with photosynthesis, and nearly all the oxygen in the atmosphere was produced by this single process.",
    chunks: {
      simplest: [
        { text: "Most food starts with plants.", icon: "🍎" },
        { text: "Most air to breathe is from plants.", icon: "🌍" },
        { text: "It is very important.", icon: "⭐" },
      ],
      simple: [
        { text: "Almost all food starts with plants.", icon: "🍎" },
        { text: "Almost all our oxygen is from plants.", icon: "🌍" },
        { text: "One small process does a big job.", icon: "⭐" },
      ],
      standard: [
        { text: "Nearly every food chain starts here.", icon: "🍎" },
        { text: "Nearly all our oxygen came from this.", icon: "🌍" },
        { text: "One quiet process built our air.", icon: "⭐" },
      ],
    },
  },
  recap: {
    dense:
      "In summary, the plant takes in sunlight, water, and carbon dioxide, builds sugar inside its chloroplasts, keeps the sugar, and releases oxygen.",
    chunks: {
      simplest: [
        { text: "Plant takes in sun, water, air.", icon: "☀️" },
        { text: "It makes sugar inside the leaf.", icon: "🍬" },
        { text: "It keeps the sugar.", icon: "🍃" },
        { text: "It lets out oxygen.", icon: "🫧" },
      ],
      simple: [
        { text: "The plant takes in sun, water, and air.", icon: "☀️" },
        { text: "Inside the leaf, it makes sugar.", icon: "🍬" },
        { text: "The plant keeps the sugar.", icon: "🍃" },
        { text: "It releases oxygen into the air.", icon: "🫧" },
      ],
      standard: [
        { text: "The plant takes in sunlight, water, and carbon dioxide.", icon: "☀️" },
        { text: "Inside the chloroplast, it builds sugar.", icon: "🍬" },
        { text: "It keeps the sugar as food.", icon: "🍃" },
        { text: "It releases oxygen into the air.", icon: "🫧" },
      ],
    },
  },
};

/** Checkpoint beats keep their normal question UI; this is the fallback for any beat with
 *  no authored chunks. */
export const DEFAULT_DYSLEXIA_BEAT: DyslexiaBeatContent | null = null;
