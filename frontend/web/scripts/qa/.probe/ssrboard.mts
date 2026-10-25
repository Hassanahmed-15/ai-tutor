// Prototype: the REAL board component rendered on the server, finished, to PNG (for a vision check).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CanvasPanel } from "../../../components/canvas/CanvasPanel";
import { layoutPanel } from "../../../lib/canvas/layout";
import { PANEL_H, PANEL_W } from "../../../lib/canvas/types";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const { Resvg } = await import("@resvg/resvg-js");
for (const pair of process.argv.slice(3)) {
  const [id, seq] = pair.split(":");
  const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.beat FROM c WHERE c.sessionId = @id AND c.sequence = @s", parameters: [{ name: "@id", value: id }, { name: "@s", value: Number(seq) }] }).fetchAll()).resources[0] as any;
  const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
  try {
    const layout = layoutPanel(spec);
    const inner = renderToStaticMarkup(createElement(CanvasPanel as any, { layout, spec, shownThrough: Infinity, sentenceProgress: 1, live: false, vars: {}, reducedMotion: true, theme: "slate" }));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${PANEL_W} ${PANEL_H}" width="${PANEL_W}" height="${PANEL_H}"><rect width="100%" height="100%" fill="#000"/>${inner}</svg>`;
    writeFileSync(`${out}/${id.slice(0, 6)}-${seq}.svg`, svg);
    const png = new Resvg(svg, { fitTo: { mode: "width", value: 1000 }, font: { loadSystemFonts: true, fontDirs: ["public/fonts"], defaultFontFamily: "Nunito" } }).render().asPng();
    writeFileSync(`${out}/${id.slice(0, 6)}-${seq}.png`, png);
    console.log("ok", id.slice(0, 6), seq, spec.stage.kind, `${Math.round(svg.length / 1024)} KB`);
  } catch (e) { console.log("FAILED", id.slice(0, 6), seq, spec.stage.kind, (e as Error).message.slice(0, 200)); }
}
