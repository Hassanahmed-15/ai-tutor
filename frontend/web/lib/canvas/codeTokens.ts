/**
 * The code card's syntax colouring (components/canvas/CanvasPanel.tsx CodeView). Pure, so it is unit-tested
 * (lib/anim/codeTokens.test.ts).
 */

const CODE_KEYWORDS = new Set(("and as break case catch class const continue def do elif else except false finally for from function if import in int is lambda let not null or pass print public range return static switch this throw true try var void while with yield None True False fn struct mut match").split(" "));

/**
 * Which comment marker a listing uses, read from the code itself (a code card carries no language name). Python,
 * pseudocode and shell use `#`, so `//` there is floor division — it was coloured as a comment, and
 * "mid = (low + high) // 2" read as "(low + high)" plus a comment (QA report 2026-11-27). Braces or semicolons
 * mean a C-style language, where `#` starts a directive and `//` the comment.
 */
export function commentMarker(lines: string[]): "hash" | "slash" | "both" {
  const code = lines.join("\n");
  if (/[{};]\s*$/m.test(code)) return "slash";
  if (/^\s*(?:def |elif |class \w+.*:\s*$|import \w|from \w+ import|for .+ in .+:\s*$|while .+:\s*$|if .+:\s*$)/m.test(code)) return "hash";
  return "both";
}

/** Light syntax colouring: enough to read structure (keywords, strings, numbers, calls, comments). */
export function codeTokens(line: string, comments: "hash" | "slash" | "both" = "both"): Array<{ text: string; color: string; italic?: boolean }> {
  const out: Array<{ text: string; color: string; italic?: boolean }> = [];
  const marker = comments === "hash" ? "#.*$" : comments === "slash" ? "\\/\\/.*$" : "#.*$|\\/\\/.*$";
  const re = new RegExp(`(${marker})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\\s*\\()|([A-Za-z_][A-Za-z0-9_]*)|(\\s+)|([^\\sA-Za-z0-9_"'#]+|#)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ text: m[1], color: "#7f8aa8", italic: true });
    else if (m[2]) out.push({ text: m[2], color: "#c3e88d" });
    else if (m[3]) out.push({ text: m[3], color: "#f78c6c" });
    else if (m[4]) out.push({ text: m[4], color: CODE_KEYWORDS.has(m[4]) ? "#c792ea" : "#82aaff" });
    else if (m[5]) out.push({ text: m[5], color: CODE_KEYWORDS.has(m[5]) ? "#c792ea" : "#e6e9f0" });
    else if (m[6]) out.push({ text: m[6], color: "#e6e9f0" });
    else out.push({ text: m[7], color: "#89ddff" });
  }
  return out;
}
