/**
 * Where the board loads a library diagram's art from (lib/figures/library.ts). The app serves it
 * from /api/figures/asset/<id>; an offline preview (scripts/figures/preview-library.tsx) points it
 * at the files on disk instead.
 */
let base = "/api/figures/asset/";
let suffix = "";

export function figureAssetHref(id: string): string {
  return `${base}${encodeURIComponent(id)}${suffix}`;
}

/** For previews only: e.g. setFigureAssetBase("file:///…/data/figures/library/", ".svg"). */
export function setFigureAssetBase(nextBase: string, nextSuffix = ""): void {
  base = nextBase;
  suffix = nextSuffix;
}
