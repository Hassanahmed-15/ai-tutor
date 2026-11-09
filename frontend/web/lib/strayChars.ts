/**
 * INVISIBLE JUNK IN WHAT THE MODEL WROTE. A model reply now and then holds a control character: U+007F just
 * before a formula made KaTeX print the formula's raw source in red, and U+0010 stood where a pseudocode "←"
 * belonged. Lines, tabs and returns are real text and stay. Applied where boards are saved and read, so
 * saved lectures are mended too.
 */
const STRAY = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const STRAY_ALL = new RegExp(STRAY.source, "g");
/** "position \u0010 3": between a name and its value it could only have been the assignment arrow. */
const LOST_ARROW = /([\w\])])[ \t]*\u0010[ \t]*(?=\S)/g;

export function cleanStrayChars<T>(value: T): T {
  if (typeof value === "string") return (STRAY.test(value) ? value.replace(LOST_ARROW, "$1 ← ").replace(STRAY_ALL, "") : value) as T;
  if (Array.isArray(value)) return value.map(cleanStrayChars) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanStrayChars(v)])) as T;
  return value;
}
