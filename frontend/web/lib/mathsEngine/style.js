// Board ink and shared drawing defaults (black board, bright chalk colours).
export const INK = {
  white: "#F4F4EE", yellow: "#FFE45C", cyan: "#5CE1FF", pink: "#FF7AB6", green: "#7CF29A",
  orange: "#FFB25C", grey: "#9a9aa6", dim: "#7d7d86", shade: "#8a8a96", red: "#FF6B6B", violet: "#B69CFF",
};
export const COLOURS = ["white", "yellow", "cyan", "pink", "green", "orange", "grey", "dim", "red", "violet"];
/** Colours given in turn to the series of a chart, the slices of a pie… */
export const SERIES = ["cyan", "pink", "green", "orange", "violet", "yellow", "red", "grey"];
export const BOARD_BG = "#000000";
export const colour = (c, fallback = INK.white) => (c ? INK[c] ?? (String(c).startsWith("#") ? c : fallback) : fallback);
export const HIDDEN = { fixed: true, highlight: false, visible: false, showInfobox: false };
// A thin black halo keeps every number and label readable where a line runs behind it.
export const FONT = 'font-family:"Patrick Hand",cursive;text-shadow:0 0 2px #000,0 0 3px #000,0 0 4px #000,0 0 1px #000;white-space:nowrap;';
