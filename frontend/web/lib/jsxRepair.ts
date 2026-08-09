/**
 * Repairs the one JSX mistake the model makes constantly: a bare `<` in text.
 *
 * `<text>BST Property: Left < Root < Right</text>` is a hard Babel syntax error — the parser reads
 * `<` as the start of a tag and reports `Unexpected token`. The whole board then fails to
 * transpile, so nothing renders at all, over a comparison operator in a caption. Measured against
 * @babel/standalone, only `<` is affected:
 *
 *   Left < Root      FAIL  Unexpected token
 *   Left > Root      OK    `>` is legal in JSX text
 *   Left &lt; Root   OK
 *   {"Left < Root"}  OK
 *
 * WHY THIS IS POSITION-GUIDED RATHER THAN A REGEX. The obvious fix — rewrite every `<` that is not
 * followed by a tag name — destroys working code, because `{progress < 0.5 ? … : …}` is in almost
 * every generated component and is perfectly valid. There is no reliable way to tell a JSX text
 * `<` from an expression `<` by pattern. So the repair only ever touches the exact character Babel
 * objected to: the parser decides what is broken, and one `<` is fixed per attempt.
 */

/** Where Babel says the parse failed. `@babel/standalone` puts this on the thrown error. */
export type ParseLoc = { line: number; column: number };

/**
 * Escapes the `<` responsible for a parse error at `loc`, or returns null if there is none.
 *
 * Babel reports the position of the token it could not accept, which is at or just after the stray
 * `<` (for `a <= b` it points at the `=`), so this scans backwards along that line. Only `<` is
 * ever rewritten — if the error is something else entirely, this returns null and the caller
 * reports the original failure rather than mangling the source.
 */
export function escapeStrayLessThan(code: string, loc: ParseLoc): string | null {
  const lines = code.split("\n");
  const index = loc.line - 1;
  const line = lines[index];
  if (line === undefined) return null;

  let at = Math.min(loc.column, line.length - 1);
  while (at >= 0 && line[at] !== "<") at--;
  if (at < 0) return null;

  lines[index] = `${line.slice(0, at)}&lt;${line.slice(at + 1)}`;
  return lines.join("\n");
}
