import { writeFileSync } from "node:fs";
import { registerFigureComponent } from "../../../lib/figures/registry";
import { dotPlot } from "../../../lib/figures/components/dotPlot";
import { boardPng } from "../../../lib/bench/renderSvg";
registerFigureComponent(dotPlot);
const [paramsJson, out] = process.argv.slice(2);
writeFileSync(out, boardPng({ v: 1, heading: "Figure", notes: [], cues: [], stage: { kind: "figure", component: "dotPlot", params: JSON.parse(paramsJson), parts: [] } } as never));
console.log("wrote", out);
