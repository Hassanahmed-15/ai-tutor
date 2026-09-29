/**
 * THE BOARD FONT — one definition for every place that draws or measures board text.
 *
 * Two families under one name, split by weight: Nunito SemiBold (rounded, very legible at label
 * size) for body text and labels, Outfit ExtraBold (geometric) for headings and emphasis. Both SIL OFL
 * 1.1 (public/fonts/*-OFL.txt). They replaced Playpen Sans, a handwriting face, on 2026-09-29 — chosen
 * on rendered boards over Nunito, Outfit and Lexend alone.
 *
 * The files are full TTFs, not Google's Latin-only WOFF2 subsets: those drop the arrows boards use
 * constantly (→ ←). A glyph neither face has (Greek, most maths operators) falls back down
 * BOARD_FONT_STACK. The sandbox (ReactAnimationSandbox) embeds these files; the critic's rasteriser
 * (reactAnimationVisionCritic) reads the same TTFs, and its width tables were measured from them in
 * Chromium — regenerate those tables if a face here changes.
 */
export const BOARD_FONT_FAMILY = "Aria Board";

export type BoardFontFace = {
  /** Served path, fetched by the sandbox and inlined as a data URL. */
  url: string;
  /** The file in public/fonts, read by the server-side rasteriser. */
  file: string;
  /** The font's own family name — what resvg matches on (it has no @font-face aliasing). */
  family: string;
  /** The CSS weight range this face serves. */
  weight: string;
};

export const BOARD_FONT_FACES: BoardFontFace[] = [
  { url: "/fonts/Nunito-SemiBold.ttf", file: "Nunito-SemiBold.ttf", family: "Nunito", weight: "100 650" },
  { url: "/fonts/Outfit-ExtraBold.ttf", file: "Outfit-ExtraBold.ttf", family: "Outfit", weight: "651 1000" },
];

/** Headings are weight > 650 and use the second face. */
export const BOARD_HEADING_WEIGHT = 651;

export const BOARD_FONT_STACK = `"${BOARD_FONT_FAMILY}","Nunito","Outfit",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;
