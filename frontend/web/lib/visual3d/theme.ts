// Design tokens for the 3D board. Colours are semantic roles, shared in spirit with Aria's 2D board
// (black board, bright chalk inks). Templates and Scene JSON name a role, never a hex value.
export const COLOR = {
  idle: "#c9cbd6",    // default object
  active: "#ffe45c",  // being considered right now
  done: "#7cf29a",    // finished / correct / visited
  muted: "#5c5f6b",   // background context
  accent: "#5ce1ff",  // the thing to look at
  warn: "#ff6b6b",    // error, collision, overshoot
  x: "#ff7a7a",       // x axis
  y: "#7cf29a",       // y axis
  z: "#6fa8ff",       // z axis
  text: "#f4f4ee",
  board: "#0b0c10",
} as const;
export type ColorToken = keyof typeof COLOR;
export const COLOR_TOKENS = Object.keys(COLOR) as ColorToken[];

/** Shape cue that goes with a colour role, so state is never shown by colour alone. */
export const STATE_MARK: Partial<Record<ColorToken, string>> = { active: "▶", done: "✓", warn: "!" };

export const SIZE = { node: 0.32, arrowHead: 0.18, line: 0.03, label: 15, labelSmall: 12 } as const;
export const FONT = '"Patrick Hand", "Comic Sans MS", system-ui, sans-serif';
export const MAX_PIXEL_RATIO = 2;
