import { writeFileSync } from "node:fs";
import { boardPng } from "../../../lib/bench/renderSvg";
const [component, paramsJson, out] = process.argv.slice(2);
const spec = { v: 1, heading: "Figure", notes: [], cues: [], stage: { kind: "figure", component, params: JSON.parse(paramsJson), parts: [] } } as never;
writeFileSync(out, boardPng(spec));
console.log("wrote", out);
