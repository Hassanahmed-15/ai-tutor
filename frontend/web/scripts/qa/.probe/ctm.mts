import { chromium } from "playwright";
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent(`<svg width="800" height="400" viewBox="0 0 800 400"><g id="g" style="transform: translate(300px, 100px)"><path id="p" d="M0 0 L100 0" stroke="red" stroke-width="3" fill="none"/></g></svg>`);
console.log(await p.evaluate(() => {
  const el = document.getElementById("p") as unknown as SVGGeometryElement;
  const m = el.getScreenCTM()!; const r = el.getBoundingClientRect();
  return { ctmE: m.e, ctmF: m.f, rectLeft: r.left, rectTop: r.top };
}));
await b.close();
