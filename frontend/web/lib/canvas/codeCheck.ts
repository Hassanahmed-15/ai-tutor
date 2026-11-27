// Server code only (it runs Python): imported by lib/canvas/progressive.ts, never by a component.
import { execFile } from "node:child_process";
import { commentMarker } from "./codeTokens";

/**
 * A PYTHON LISTING THAT IS NOT PYTHON (QA report 2026-11-27: a binary-search board showed an "iterative version"
 * with no `def` and no `low`/`high` set up — lines 11-18 were not valid Python). A Python-looking code board is
 * parsed by Python itself; a listing it refuses is sent back to the writer with the parser's own message, through the
 * same rewrite loop the board's other faults use (lib/progressiveLectureWorker.ts). No Python on this machine, or a
 * listing that is not Python, is never a fault.
 */
const PYTHON = process.env.PDF_PYTHON_BINARY ?? "python3";
const PARSE = "import ast,sys\ntry:\n ast.parse(sys.stdin.read())\nexcept SyntaxError as e:\n print(f'line {e.lineno}: {e.msg}')\n";

/** Lines that only show a fragment on purpose ("...", a lone signature) are not meant to run on their own. */
function looksLikeWholeListing(lines: string[]): boolean {
  return lines.length >= 3 && !lines.some((l) => /^\s*(?:\.\.\.|…)\s*$/.test(l));
}

export async function pythonListingFault(lines: string[]): Promise<string | null> {
  if (commentMarker(lines) !== "hash" || !looksLikeWholeListing(lines)) return null;
  // Pseudocode (IGCSE style: INPUT, OUTPUT, ENDIF) is marked like Python but is not Python.
  if (lines.some((l) => /^\s*(?:INPUT|OUTPUT|ENDIF|ENDWHILE|DECLARE|PROCEDURE|REPEAT|UNTIL)\b/.test(l))) return null;
  const verdict = await new Promise<string | null>((resolve) => {
    try {
      const child = execFile(PYTHON, ["-c", PARSE], { timeout: 4_000, windowsHide: true }, (error, stdout) => {
        if (error) return resolve(null); // no Python here, or it timed out: never a fault
        resolve(stdout.trim() || null);
      });
      child.stdin?.end(lines.join("\n"));
    } catch {
      resolve(null);
    }
  });
  return verdict ? `The code listing is not valid Python (${verdict}). Every line shown must run as written: a second version (iterative after recursive, say) is a complete function of its own, with its def line and every variable it uses set up.` : null;
}
