/** Solution colours by name: an indicator's colour is chemistry, so it is chosen by word, not by hex. */
const NAMED: Record<string, string> = {
  colourless: "#e6f2f8", clear: "#e6f2f8", water: "#e6f2f8",
  pink: "#f472b6", magenta: "#db2777", red: "#ef4444", orange: "#fb923c", yellow: "#facc15",
  green: "#22c55e", blue: "#3b82f6", "pale blue": "#93c5fd", purple: "#a855f7", brown: "#92400e", "blue-black": "#1e3a8a",
};
export function solutionColour(name: unknown, fallback = "colourless"): `#${string}` {
  const key = String(name ?? "").toLowerCase().trim();
  return (NAMED[key] ?? NAMED[fallback] ?? NAMED.colourless) as `#${string}`;
}
