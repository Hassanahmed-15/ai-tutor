/**
 * THE PASSWORD RULES — one list, checked live on the sign-up screen and enforced by the server.
 *
 * Length, not composition (NIST SP 800-63B, and the owner's choice, 2026-09-29): at least ten
 * characters, not a well-known password, and not built from the account's own email or username.
 * Symbol-and-digit rules mostly produce predictable substitutions ("P@ssw0rd1") and are not used.
 */

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

/** Passwords that appear at the top of every breach list, plus the obvious ten-character ones. */
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword",
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "0123456789", "0987654321",
  "qwerty", "qwerty123", "qwertyuiop", "qwerty1234", "asdfghjkl", "asdfghjkl1", "zxcvbnm123", "1q2w3e4r5t", "1qaz2wsx3edc",
  "iloveyou", "iloveyou12", "letmein", "letmein123", "welcome", "welcome123", "welcome1234", "admin", "admin12345", "administrator",
  "football", "football123", "baseball", "baseball12", "princess", "princess12", "sunshine", "sunshine12", "dragon", "dragon1234",
  "monkey", "monkey1234", "abc123", "abcdefghij", "abcd123456", "trustno1", "superman", "superman12", "starwars", "whatever",
  "passwordpassword", "aaaaaaaaaa", "1111111111", "0000000000", "changeme", "changeme123", "secret1234", "mypassword", "yourpassword",
  "pakistan123", "pakistan12", "india12345", "london1234", "computer12", "internet12", "student123", "teacher123", "school1234",
]);

export type PasswordCheck = { id: "length" | "common" | "personal"; label: string; ok: boolean };

/** Every rule with whether it passes — the live checklist under the field. */
export function passwordChecks(password: string, context: { email?: string; username?: string } = {}): PasswordCheck[] {
  const lower = password.toLowerCase();
  const local = (context.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  const username = (context.username ?? "").toLowerCase();
  const personal = [local, username].filter((part) => part.length >= 4);
  const repeated = /^(.)\1+$/.test(password);
  return [
    { id: "length", label: `At least ${MIN_PASSWORD} characters`, ok: password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD },
    { id: "common", label: "Not a common or easily guessed password", ok: password.length > 0 && !COMMON.has(lower) && !repeated },
    { id: "personal", label: "Doesn't contain your email or username", ok: password.length > 0 && !personal.some((part) => lower.includes(part)) },
  ];
}

/** The first failing rule, as a sentence for the server's reply; null when the password is fine. */
export function passwordProblem(password: string, context: { email?: string; username?: string } = {}): string | null {
  if (password.length > MAX_PASSWORD) return `Use at most ${MAX_PASSWORD} characters.`;
  const failed = passwordChecks(password, context).find((c) => !c.ok);
  if (!failed) return null;
  if (failed.id === "length") return `Use at least ${MIN_PASSWORD} characters — length matters more than symbols.`;
  if (failed.id === "common") return "That password is too common — choose something less guessable.";
  return "Don't use your email or username in your password.";
}
